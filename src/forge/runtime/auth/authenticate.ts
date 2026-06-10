import {
  FORGE_AUTH_DISABLED,
  FORGE_AUTH_MISSING_TOKEN,
  FORGE_AUTH_MODE_INVALID,
} from "../../compiler/diagnostics/codes.ts";
import type { ForgeAuthConfig } from "./config.ts";
import { mapClaimsToAuthContext } from "./claims.ts";
import { ForgeAuthError } from "./errors.ts";
import { parseAuthHeaders } from "./resolve.ts";
import type { AuthContext } from "./types.ts";
import { verifyJwtToken } from "./verifier.ts";

export function extractBearerToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (!authorization) {
    return null;
  }
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function authenticateHeaders(
  headers: Headers,
  config: ForgeAuthConfig,
): Promise<AuthContext> {
  if (config.mode === "dev-headers") {
    return parseAuthHeaders(headers);
  }

  if (config.mode === "disabled") {
    return { kind: "anonymous" };
  }

  if (config.mode === "jwt" || config.mode === "oidc") {
    const token = extractBearerToken(headers);
    if (!token) {
      throw new ForgeAuthError(
        FORGE_AUTH_MISSING_TOKEN,
        "missing Authorization: Bearer token",
      );
    }
    const verified = await verifyJwtToken(token, config);
    return mapClaimsToAuthContext(verified.payload, config, verified.token);
  }

  throw new ForgeAuthError(
    FORGE_AUTH_MODE_INVALID,
    `unsupported auth mode '${String(config.mode)}'`,
  );
}

export function disabledAuthWarning(): ForgeAuthError {
  return new ForgeAuthError(
    FORGE_AUTH_DISABLED,
    "FORGE_AUTH_MODE=disabled leaves this runtime unauthenticated",
    { status: 200 },
  );
}
