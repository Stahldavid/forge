import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";

export type ForgeAuthMode = "dev-headers" | "jwt" | "oidc" | "disabled";

export interface AuthClaimsMapping {
  userId: string;
  tenantId?: string;
  role?: string;
  roles?: string;
  permissions?: string;
  email?: string;
  name?: string;
}

export interface AuthRegistryArtifact {
  schemaVersion: string;
  defaultMode: ForgeAuthMode;
  modes: ForgeAuthMode[];
  issuerEnv: string;
  audienceEnv: string;
  jwksUriEnv: string;
  algorithmsEnv: string;
  claims: AuthClaimsMapping;
  requiresTenant: boolean;
}

export interface ForgeAuthConfig {
  mode: ForgeAuthMode;
  issuer?: string;
  audience?: string | string[];
  jwksUri?: string;
  algorithms: string[];
  claims: AuthClaimsMapping;
  requiresTenant: boolean;
  authProvider?: string;
}

export const DEFAULT_AUTH_CLAIMS: AuthClaimsMapping = {
  userId: "sub",
  tenantId: "tenant_id",
  role: "role",
  roles: "roles",
  permissions: "permissions",
  email: "email",
  name: "name",
};

export const AUTH_ENV = {
  mode: "FORGE_AUTH_MODE",
  issuer: "FORGE_AUTH_ISSUER",
  audience: "FORGE_AUTH_AUDIENCE",
  jwksUri: "FORGE_AUTH_JWKS_URI",
  algorithms: "FORGE_AUTH_ALGORITHMS",
} as const;

export function isForgeAuthMode(value: string): value is ForgeAuthMode {
  return (
    value === "dev-headers" ||
    value === "jwt" ||
    value === "oidc" ||
    value === "disabled"
  );
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

export function loadAuthRegistry(
  workspaceRoot: string,
): AuthRegistryArtifact | null {
  return readGeneratedJson<AuthRegistryArtifact>(
    workspaceRoot,
    `${GENERATED_DIR}/authRegistry.json`,
  );
}

function parseAudience(value: string | undefined): string | string[] | undefined {
  if (!value) {
    return undefined;
  }
  const values = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return values.length > 1 ? values : values[0];
}

function parseAlgorithms(value: string | undefined): string[] {
  const algorithms = (value ?? "RS256")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return algorithms.length > 0 ? algorithms : ["RS256"];
}

export function resolveAuthMode(
  value: string | undefined,
  fallback: ForgeAuthMode,
): ForgeAuthMode {
  return value && isForgeAuthMode(value) ? value : fallback;
}

export function loadAuthConfigFromEnv(
  workspaceRoot: string,
  options: { defaultMode?: ForgeAuthMode; requiresTenant?: boolean } = {},
): ForgeAuthConfig {
  const registry = loadAuthRegistry(workspaceRoot);
  const mode = resolveAuthMode(
    process.env[AUTH_ENV.mode],
    options.defaultMode ?? registry?.defaultMode ?? "dev-headers",
  );

  return {
    mode,
    issuer: process.env[AUTH_ENV.issuer],
    audience: parseAudience(process.env[AUTH_ENV.audience]),
    jwksUri: process.env[AUTH_ENV.jwksUri],
    algorithms: parseAlgorithms(process.env[AUTH_ENV.algorithms]),
    claims: registry?.claims ?? DEFAULT_AUTH_CLAIMS,
    requiresTenant: options.requiresTenant ?? registry?.requiresTenant ?? false,
    authProvider: mode,
  };
}

export function buildDefaultAuthRegistry(
  requiresTenant: boolean,
): AuthRegistryArtifact {
  return {
    schemaVersion: "0.1.0",
    defaultMode: "dev-headers",
    modes: ["dev-headers", "jwt", "oidc", "disabled"],
    issuerEnv: AUTH_ENV.issuer,
    audienceEnv: AUTH_ENV.audience,
    jwksUriEnv: AUTH_ENV.jwksUri,
    algorithmsEnv: AUTH_ENV.algorithms,
    claims: DEFAULT_AUTH_CLAIMS,
    requiresTenant,
  };
}
