import {
  FORGE_AUTH_CLAIM_MISSING,
  FORGE_AUTH_TENANT_MISSING,
} from "../../compiler/diagnostics/codes.ts";
import type { AuthClaimsMapping, ForgeAuthConfig } from "./config.ts";
import { ForgeAuthError } from "./errors.ts";
import type { AuthContext } from "./types.ts";

export interface VerifiedTokenMetadata {
  issuer?: string;
  audience?: string | string[];
  subject?: string;
  expiresAt?: number;
  issuedAt?: number;
  authProvider: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getClaimValue(
  claims: Record<string, unknown>,
  path: string | undefined,
): unknown {
  if (!path) {
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(claims, path)) {
    return claims[path];
  }

  let current: unknown = claims;
  for (const part of path.split(".")) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

export function mapClaimsToAuthContext(
  payload: Record<string, unknown>,
  config: ForgeAuthConfig,
  token: VerifiedTokenMetadata,
): AuthContext {
  const mapping: AuthClaimsMapping = config.claims;
  const userId = asString(getClaimValue(payload, mapping.userId));
  if (!userId) {
    throw new ForgeAuthError(
      FORGE_AUTH_CLAIM_MISSING,
      `required auth claim '${mapping.userId}' is missing`,
    );
  }

  const tenantId = asString(getClaimValue(payload, mapping.tenantId));
  if (config.requiresTenant && !tenantId) {
    throw new ForgeAuthError(
      FORGE_AUTH_TENANT_MISSING,
      "tenant claim is required for this Forge project",
      { status: 403 },
    );
  }

  const role = asString(getClaimValue(payload, mapping.role));
  const roles = uniqueSorted([
    ...(role ? [role] : []),
    ...asStringArray(getClaimValue(payload, mapping.roles)),
  ]);
  const permissions = uniqueSorted(
    asStringArray(getClaimValue(payload, mapping.permissions)),
  );

  return {
    kind: "user",
    userId,
    ...(tenantId ? { tenantId } : {}),
    ...(role ? { role } : roles[0] ? { role: roles[0] } : {}),
    roles,
    permissions,
    ...(asString(getClaimValue(payload, mapping.email))
      ? { email: asString(getClaimValue(payload, mapping.email)) }
      : {}),
    ...(asString(getClaimValue(payload, mapping.name))
      ? { name: asString(getClaimValue(payload, mapping.name)) }
      : {}),
    token: {
      issuer: token.issuer ?? "",
      audience: token.audience ?? "",
      subject: token.subject ?? userId,
      ...(token.expiresAt ? { expiresAt: token.expiresAt } : {}),
      ...(token.issuedAt ? { issuedAt: token.issuedAt } : {}),
      authProvider: token.authProvider,
    },
    claims: payload,
  };
}
