import { decodeJwt } from "jose";
import {
  FORGE_AUTH_INVALID_ISSUER,
  FORGE_AUTH_INVALID_AUDIENCE,
  FORGE_AUTH_JWKS_FAILED,
} from "../compiler/diagnostics/codes.ts";
import { loadAuthConfigFromEnv } from "../runtime/auth/config.ts";
import { mapClaimsToAuthContext } from "../runtime/auth/claims.ts";
import { ForgeAuthError } from "../runtime/auth/errors.ts";
import { verifyJwtToken } from "../runtime/auth/verifier.ts";

export type AuthSubcommand = "check" | "config" | "decode" | "test-token" | "jwks";

export interface AuthCommandOptions {
  subcommand: AuthSubcommand;
  workspaceRoot: string;
  json: boolean;
  token?: string;
}

export interface AuthCommandResult {
  ok: boolean;
  mode: string;
  data?: unknown;
  error?: { code: string; message: string };
  exitCode: 0 | 1;
}

function validateConfig(workspaceRoot: string): AuthCommandResult {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  const errors: { code: string; message: string }[] = [];

  if ((config.mode === "jwt" || config.mode === "oidc") && !config.issuer) {
    errors.push({
      code: FORGE_AUTH_INVALID_ISSUER,
      message: "FORGE_AUTH_ISSUER is required for jwt/oidc auth",
    });
  }
  if ((config.mode === "jwt" || config.mode === "oidc") && !config.audience) {
    errors.push({
      code: FORGE_AUTH_INVALID_AUDIENCE,
      message: "FORGE_AUTH_AUDIENCE is required for jwt/oidc auth",
    });
  }
  if (config.mode === "jwt" && !config.jwksUri) {
    errors.push({
      code: FORGE_AUTH_JWKS_FAILED,
      message: "FORGE_AUTH_JWKS_URI is required for jwt auth",
    });
  }

  return {
    ok: errors.length === 0,
    mode: config.mode,
    data: {
      mode: config.mode,
      issuerConfigured: Boolean(config.issuer),
      audienceConfigured: Boolean(config.audience),
      jwksConfigured: Boolean(config.jwksUri),
      algorithms: config.algorithms,
      claims: config.claims,
      requiresTenant: config.requiresTenant,
      errors,
    },
    error: errors[0],
    exitCode: errors.length === 0 ? 0 : 1,
  };
}

function publicConfig(workspaceRoot: string): AuthCommandResult {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  return {
    ok: true,
    mode: config.mode,
    data: {
      mode: config.mode,
      issuer: config.issuer,
      audience: config.audience,
      jwksConfigured: Boolean(config.jwksUri),
      algorithms: config.algorithms,
      claims: config.claims,
      requiresTenant: config.requiresTenant,
    },
    exitCode: 0,
  };
}

function decodeToken(workspaceRoot: string, token: string | undefined): AuthCommandResult {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  if (!token) {
    return {
      ok: false,
      mode: config.mode,
      error: { code: "FORGE_AUTH_MISSING_TOKEN", message: "--token is required" },
      exitCode: 1,
    };
  }

  try {
    return {
      ok: true,
      mode: config.mode,
      data: {
        warning: "decoded without signature verification",
        claims: decodeJwt(token),
      },
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to decode JWT";
    return {
      ok: false,
      mode: config.mode,
      error: { code: "FORGE_AUTH_INVALID_TOKEN", message },
      exitCode: 1,
    };
  }
}

async function testToken(
  workspaceRoot: string,
  token: string | undefined,
): Promise<AuthCommandResult> {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  if (!token) {
    return {
      ok: false,
      mode: config.mode,
      error: { code: "FORGE_AUTH_MISSING_TOKEN", message: "--token is required" },
      exitCode: 1,
    };
  }

  try {
    const verified = await verifyJwtToken(token, config);
    const auth = mapClaimsToAuthContext(verified.payload, config, verified.token);
    return {
      ok: true,
      mode: config.mode,
      data: { auth },
      exitCode: 0,
    };
  } catch (error) {
    const authError =
      error instanceof ForgeAuthError
        ? error
        : new ForgeAuthError(
            "FORGE_AUTH_INVALID_TOKEN",
            error instanceof Error ? error.message : "token failed verification",
          );
    return {
      ok: false,
      mode: config.mode,
      error: { code: authError.code, message: authError.message },
      exitCode: 1,
    };
  }
}

export async function runAuthCommand(
  options: AuthCommandOptions,
): Promise<AuthCommandResult> {
  if (options.subcommand === "check") {
    return validateConfig(options.workspaceRoot);
  }
  if (options.subcommand === "config") {
    return publicConfig(options.workspaceRoot);
  }
  if (options.subcommand === "decode") {
    return decodeToken(options.workspaceRoot, options.token);
  }
  if (options.subcommand === "test-token") {
    return testToken(options.workspaceRoot, options.token);
  }

  const config = loadAuthConfigFromEnv(options.workspaceRoot);
  return {
    ok: true,
    mode: config.mode,
    data: {
      mode: config.mode,
      jwksUri: config.jwksUri,
      oidcDiscovery: config.mode === "oidc",
    },
    exitCode: 0,
  };
}

export function formatAuthJson(result: AuthCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatAuthHuman(result: AuthCommandResult): string {
  if (!result.ok) {
    return `Auth ${result.mode}: failed\n${result.error?.code}: ${result.error?.message}\n`;
  }
  return `Auth ${result.mode}: ok\n${JSON.stringify(result.data, null, 2)}\n`;
}
