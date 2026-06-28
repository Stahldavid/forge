import { decodeJwt } from "jose";
import {
  FORGE_AUTH_INVALID_ISSUER,
  FORGE_AUTH_INVALID_AUDIENCE,
  FORGE_AUTH_JWKS_FAILED,
} from "../compiler/diagnostics/codes.ts";
import { loadAuthConfigFromEnv, type AuthClaimsMapping } from "../runtime/auth/config.ts";
import { mapClaimsToAuthContext } from "../runtime/auth/claims.ts";
import { ForgeAuthError } from "../runtime/auth/errors.ts";
import { verifyJwtToken } from "../runtime/auth/verifier.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { normalizeForgeCliCommandsInValue } from "../workspace/forge-cli.ts";
import {
  collectExpectedResourceTypes,
  collectPolicyPermissions,
  missingValues,
  parseSeedFile,
} from "./workos.ts";

export type AuthSubcommand = "check" | "config" | "decode" | "test-token" | "jwks" | "prove" | "status";

export interface AuthCommandOptions {
  subcommand: AuthSubcommand;
  workspaceRoot: string;
  json: boolean;
  token?: string;
  prod?: boolean;
  scenario?: string;
}

export interface AuthCommandResult {
  ok: boolean;
  mode: string;
  data?: unknown;
  error?: { code: string; message: string };
  exitCode: 0 | 1;
}

function detectWorkOS(workspaceRoot: string, claims: AuthClaimsMapping) {
  const secretRegistry = loadSecretRegistry(workspaceRoot);
  const secretNames = new Set((secretRegistry?.secrets ?? []).map((secret) => secret.name));
  const detected =
    secretNames.has("WORKOS_API_KEY") ||
    secretNames.has("WORKOS_CLIENT_ID") ||
    claims.tenantId === "organization_id";
  const expectedClaims = {
    userId: "sub",
    email: "email",
    tenantId: "organization_id",
    role: "role",
    roles: "roles",
    permissions: "permissions",
  };
  const claimStatus = Object.entries(expectedClaims).map(([name, expected]) => ({
    name,
    expected,
    actual: claims[name as keyof AuthClaimsMapping],
    ok: claims[name as keyof AuthClaimsMapping] === expected,
  }));
  return {
    detected,
    requiredSecretsRegistered: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"].every((name) =>
      secretNames.has(name)
    ),
    webhookSecretRegistered: secretNames.has("WORKOS_WEBHOOK_SECRET"),
    expectedClaims,
    claimStatus,
  };
}

function configErrors(config: ReturnType<typeof loadAuthConfigFromEnv>): { code: string; message: string }[] {
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
  return errors;
}

function buildAuthPosture(workspaceRoot: string) {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  const productionMode = config.mode === "jwt" || config.mode === "oidc";
  const errors = configErrors(config);
  const configReady = errors.length === 0;
  const classification = config.mode === "dev-headers"
    ? "local-dev"
    : config.mode === "disabled"
      ? "unauthenticated"
      : configReady
        ? "production-ready"
        : "production-incomplete";
  const reason = productionMode
    ? configReady
      ? "jwt/oidc production auth configuration is present"
      : "jwt/oidc production auth is selected but required settings are missing"
    : config.mode === "disabled"
      ? "auth is disabled; this is not suitable for public production traffic"
      : "dev-headers auth is local-only and is not real production authentication";
  return normalizeForgeCliCommandsInValue(workspaceRoot, {
    schemaVersion: "0.1.0",
    mode: config.mode,
    classification,
    localOnly: config.mode === "dev-headers",
    productionReady: productionMode && configReady,
    requiresTenant: config.requiresTenant,
    bearerHeader: productionMode ? "Authorization: Bearer <token>" : null,
    tenantClaim: config.claims.tenantId ?? "tenant_id",
    environment: {
      current: classification,
      localDevelopment: config.mode === "dev-headers",
      publicProduction: productionMode && configReady,
      warning: reason,
    },
    localDevHeaders: config.mode === "dev-headers"
      ? {
          acceptedHeaders: [
            "x-forge-user-id",
            "x-forge-tenant-id",
            "x-forge-role",
            "x-forge-roles",
            "x-forge-permissions",
          ],
          scope: "forge dev, tests, and local agent workflows only",
          neverProduction: true,
        }
      : null,
    productionRequirements: {
      requiredMode: "jwt or oidc",
      bearerHeader: "Authorization: Bearer <token>",
      requiredEnv: [
        "FORGE_AUTH_MODE",
        "FORGE_AUTH_ISSUER",
        "FORGE_AUTH_AUDIENCE",
        config.mode === "oidc" ? "OIDC discovery at FORGE_AUTH_ISSUER" : "FORGE_AUTH_JWKS_URI",
      ],
      proofCommand: "forge auth prove --prod --token <jwt> --json",
    },
    productionChecklist: [
      { item: "auth mode is jwt or oidc", ok: productionMode },
      { item: "FORGE_AUTH_ISSUER configured", ok: Boolean(config.issuer) },
      { item: "FORGE_AUTH_AUDIENCE configured", ok: Boolean(config.audience) },
      { item: "FORGE_AUTH_JWKS_URI or OIDC discovery configured", ok: config.mode === "oidc" || Boolean(config.jwksUri) },
      { item: "tenant claim mapped", ok: Boolean(config.claims.tenantId) },
      { item: "permission claim mapped", ok: Boolean(config.claims.permissions) },
      { item: "dev-headers disabled for public runtime", ok: config.mode !== "dev-headers" },
    ],
    reason,
    nextActions: productionMode
      ? configReady
        ? ["forge auth prove --prod --token <jwt> --json", "forge serve --json"]
        : ["forge auth check --json", "configure FORGE_AUTH_ISSUER, FORGE_AUTH_AUDIENCE, and FORGE_AUTH_JWKS_URI or OIDC issuer"]
      : ["set FORGE_AUTH_MODE=jwt or oidc for production", "forge auth prove --prod --token <jwt> --json"],
  });
}

function permissionSubsetForRestrictedTenant(permissions: string[]): string[] {
  const readonly = permissions.filter((permission) =>
    /(^|[:._-])(read|list|view|inspect|search)($|[:._-])/.test(permission)
  );
  if (readonly.length > 0) return readonly;
  return permissions.slice(0, Math.max(1, Math.floor(permissions.length / 2)));
}

function buildMultiTenantProof(workspaceRoot: string, workos: ReturnType<typeof detectWorkOS>, requiresTenant: boolean) {
  const rootSeedPresent = existsSync(join(workspaceRoot, "workos-seed.yml"));
  const generatedSeedPresent = existsSync(join(workspaceRoot, "src/forge/_generated/integrations/workos/workos-seed.yml"));
  const authMdPresent = existsSync(join(workspaceRoot, "public/auth.md"));
  const metadataPresent = existsSync(join(workspaceRoot, "public/.well-known/oauth-protected-resource"));
  const activePermissions = collectPolicyPermissions(workspaceRoot);
  const expectedResourceTypes = collectExpectedResourceTypes(workspaceRoot);
  const seed = parseSeedFile(workspaceRoot);
  const missingSeedPermissions = missingValues(activePermissions, seed.permissions);
  const missingSeedResources = missingValues(expectedResourceTypes, seed.resourceTypes);
  const acmePermissions = activePermissions;
  const globexPermissions = permissionSubsetForRestrictedTenant(activePermissions);
  const permissionVocabularyPresent = workos.detected && workos.claimStatus.some((claim) => claim.name === "permissions" && claim.ok);
  const checks = [
    {
      id: "tenant-claim",
      ok: requiresTenant && workos.claimStatus.some((claim) => claim.name === "tenantId" && claim.ok),
      evidence: "Forge tenant claim maps to WorkOS organization_id and tenant auth is required.",
    },
    {
      id: "permission-claim",
      ok: activePermissions.length > 0 && permissionVocabularyPresent,
      evidence: activePermissions.length > 0
        ? `Forge permissions claim maps to WorkOS permissions: ${activePermissions.join(", ")}.`
        : "No active policy permissions were found in the generated policy registry.",
    },
    {
      id: "seed-organizations",
      ok: rootSeedPresent || generatedSeedPresent,
      evidence: rootSeedPresent
        ? "workos-seed.yml exists at app root."
        : generatedSeedPresent
          ? "generated WorkOS seed exists."
          : "no WorkOS seed file found at app root or in generated integrations.",
    },
    {
      id: "seed-permission-coverage",
      ok: activePermissions.length > 0 && missingSeedPermissions.length === 0,
      evidence: activePermissions.length === 0
        ? "No active policy permissions were found in the generated policy registry."
        : missingSeedPermissions.length === 0
          ? `seed covers active app permission(s): ${activePermissions.join(", ")}`
        : `seed missing active app permission(s): ${missingSeedPermissions.join(", ")}`,
    },
    {
      id: "seed-resource-coverage",
      ok: missingSeedResources.length === 0,
      evidence: missingSeedResources.length === 0
        ? `seed covers expected app resource type(s): ${expectedResourceTypes.join(", ") || "none required"}`
        : `seed missing expected app resource type(s): ${missingSeedResources.join(", ")}`,
    },
    {
      id: "agent-auth-metadata",
      ok: authMdPresent && metadataPresent,
      evidence: "public/auth.md and protected resource metadata are present.",
    },
  ];
  return normalizeForgeCliCommandsInValue(workspaceRoot, {
    scenario: "multi-tenant",
    ok: checks.every((check) => check.ok),
    claims: {
      acme: { organization_id: "org_acme", role: "owner", permissions: acmePermissions },
      globex: { organization_id: "org_globex", role: "member", permissions: globexPermissions },
    },
    appContract: {
      activePermissions,
      expectedResourceTypes,
      seedPath: seed.path,
      seedPermissions: seed.permissions,
      seedResourceTypes: seed.resourceTypes,
    },
    invariants: [
      "Acme and Globex must use different organization_id claim values.",
      "Tenant-scoped reads must include the active organization_id.",
      "Tenant-scoped writes must verify the resource tenant before mutation.",
      "Role-only UI affordances are not sufficient; policies must use the app's generated permission vocabulary.",
    ],
    checks,
    nextActions: [
      "forge workos doctor --json",
      "forge workos seed --file workos-seed.yml --dry-run --json",
      "run an HTTP E2E with Acme and Globex tokens before production",
    ],
  });
}

function validateConfig(workspaceRoot: string): AuthCommandResult {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  const errors = configErrors(config);
  const workos = detectWorkOS(workspaceRoot, config.claims);

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
      authPosture: buildAuthPosture(workspaceRoot),
      workos,
      errors,
    },
    error: errors[0],
    exitCode: errors.length === 0 ? 0 : 1,
  };
}

function publicConfig(workspaceRoot: string): AuthCommandResult {
  const config = loadAuthConfigFromEnv(workspaceRoot);
  const workos = detectWorkOS(workspaceRoot, config.claims);
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
      authPosture: buildAuthPosture(workspaceRoot),
      workos,
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
  if (options.subcommand === "status") {
    const posture = buildAuthPosture(options.workspaceRoot);
    return {
      ok: true,
      mode: posture.mode,
      data: posture,
      exitCode: 0,
    };
  }
  if (options.subcommand === "check") {
    const checked = validateConfig(options.workspaceRoot);
    if (!options.prod) {
      return checked;
    }
    const posture = buildAuthPosture(options.workspaceRoot);
    const productionReady = posture.productionReady === true;
    return {
      ok: checked.ok && productionReady,
      mode: checked.mode,
      data: {
        ...(checked.data && typeof checked.data === "object" ? checked.data as Record<string, unknown> : {}),
        production: true,
        authPosture: posture,
        productionCheck: {
          ok: productionReady,
          reason: posture.reason,
          requiredMode: "jwt or oidc",
          localOnlyModeRejected: posture.localOnly === true,
        },
      },
      error: productionReady
        ? checked.error
        : { code: "FORGE_AUTH_MODE_INVALID", message: "production auth requires FORGE_AUTH_MODE=jwt or oidc; dev-headers is local-only" },
      exitCode: checked.ok && productionReady ? 0 : 1,
    };
  }
  if (options.subcommand === "prove") {
    const checked = validateConfig(options.workspaceRoot);
    const config = loadAuthConfigFromEnv(options.workspaceRoot);
    const workos = detectWorkOS(options.workspaceRoot, config.claims);
    const productionMode = config.mode === "jwt" || config.mode === "oidc";
    const workosClaimsOk = workos.claimStatus.every((claim) => claim.ok);
    const posture = buildAuthPosture(options.workspaceRoot);
    const tokenProof = options.token ? await testToken(options.workspaceRoot, options.token) : null;
    const prodError = options.prod && !productionMode
      ? { code: "FORGE_AUTH_MODE_INVALID", message: "forge auth prove --prod requires FORGE_AUTH_MODE=jwt or oidc" }
      : options.prod && !options.token
        ? { code: "FORGE_AUTH_MISSING_TOKEN", message: "forge auth prove --prod requires --token" }
        : options.prod && tokenProof && !tokenProof.ok
          ? tokenProof.error
          : undefined;
    const proofOk = checked.ok && (!options.prod || (productionMode && tokenProof?.ok === true));
    const multiTenantProof = options.scenario === "multi-tenant"
      ? buildMultiTenantProof(options.workspaceRoot, workos, config.requiresTenant)
      : null;
    const scenarioOk = !multiTenantProof || multiTenantProof.ok;
    return {
      ok: proofOk && scenarioOk,
      mode: config.mode,
      data: {
        schemaVersion: "0.1.0",
        kind: "auth-proof",
        ok: proofOk,
        mode: config.mode,
        productionReady: productionMode && checked.ok,
        prod: options.prod === true,
        scenario: options.scenario ?? null,
        authPosture: posture,
        ...(tokenProof ? { tokenProof: tokenProof.ok ? tokenProof.data : tokenProof.error } : {}),
        ...(multiTenantProof ? { multiTenantProof } : {}),
        invariants: [
          {
            id: "INV-001",
            name: "dev headers are not production auth",
            status: productionMode ? "passed" : "local-only",
            evidence: productionMode
              ? "jwt/oidc mode configured through environment"
              : "dev-headers mode is allowed only for local dev, tests, and agent workflows",
          },
          {
            id: "INV-001-CONFIG",
            name: "jwt/oidc required settings are present when production auth is enabled",
            status: checked.ok ? "passed" : "failed",
            evidence: checked.data,
          },
          {
            id: "INV-WORKOS-001",
            name: "WorkOS adapter claim mapping is explicit when WorkOS is present",
            status: !workos.detected ? "not-applicable" : workosClaimsOk ? "passed" : "failed",
            evidence: workos.claimStatus,
          },
          {
            id: "INV-WORKOS-002",
            name: "WorkOS required secret names are registered without values",
            status: !workos.detected ? "not-applicable" : workos.requiredSecretsRegistered ? "passed" : "failed",
            evidence: {
              required: ["WORKOS_API_KEY", "WORKOS_CLIENT_ID", "WORKOS_COOKIE_PASSWORD"],
              webhookSecretRegistered: workos.webhookSecretRegistered,
            },
          },
        ],
        workos,
        checkedAt: "deterministic",
      },
      error: prodError ?? checked.error,
      exitCode: proofOk && scenarioOk ? 0 : 1,
    };
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

function authPostureFromResult(result: AuthCommandResult): Record<string, unknown> | null {
  const data = result.data && typeof result.data === "object" ? result.data as Record<string, unknown> : {};
  const direct = data.schemaVersion === "0.1.0" && "classification" in data ? data : null;
  const nested = data.authPosture && typeof data.authPosture === "object"
    ? data.authPosture as Record<string, unknown>
    : null;
  return direct ?? nested;
}

export function formatAuthHuman(result: AuthCommandResult): string {
  const posture = authPostureFromResult(result);
  if (posture) {
    const classification = typeof posture.classification === "string" ? posture.classification : result.mode;
    const reason = typeof posture.reason === "string" ? posture.reason : result.error?.message;
    const nextActions = Array.isArray(posture.nextActions) ? posture.nextActions.filter((item): item is string => typeof item === "string") : [];
    const lines = [
      `Auth ${result.mode}: ${result.ok ? "ok" : "failed"} (${classification})`,
      `Production ready: ${posture.productionReady === true ? "yes" : "no"}`,
      ...(reason ? [`Reason: ${reason}`] : []),
    ];
    const localDevHeaders = posture.localDevHeaders && typeof posture.localDevHeaders === "object"
      ? posture.localDevHeaders as Record<string, unknown>
      : null;
    const acceptedHeaders = Array.isArray(localDevHeaders?.acceptedHeaders)
      ? localDevHeaders.acceptedHeaders.filter((item): item is string => typeof item === "string")
      : posture.localOnly === true || result.mode === "dev-headers"
        ? [
            "x-forge-user-id",
            "x-forge-tenant-id",
            "x-forge-role",
            "x-forge-roles",
            "x-forge-permissions",
          ]
        : [];
    if (acceptedHeaders.length > 0) {
      lines.push("Local dev headers:", ...acceptedHeaders.map((header) => `  ${header}`));
    }
    if (!result.ok && result.error) {
      lines.push(`${result.error.code}: ${result.error.message}`);
    }
    if (nextActions.length > 0) {
      lines.push("", "Next:", ...nextActions.map((action) => `  ${action}`));
    }
    return `${lines.join("\n")}\n`;
  }
  if (!result.ok) {
    return `Auth ${result.mode}: failed\n${result.error?.code}: ${result.error?.message}\n`;
  }
  return `Auth ${result.mode}: ok\n${JSON.stringify(result.data, null, 2)}\n`;
}
