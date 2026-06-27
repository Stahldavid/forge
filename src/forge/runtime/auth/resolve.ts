import type { AuthContext } from "./types.ts";

export interface AuthHeaderInput {
  userId?: string;
  tenantId?: string;
  organizationId?: string;
  organizationMembershipId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
  claims?: Record<string, unknown>;
}

export interface CliAuthInput {
  userId?: string;
  tenantId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
}

export function resolveAuthFromHeaders(input: AuthHeaderInput): AuthContext {
  const { userId, role } = input;
  const tenantId = input.tenantId ?? input.organizationId;
  const roles = [...new Set([...(role ? [role] : []), ...(input.roles ?? [])])];
  const claims = {
    ...(input.claims ?? {}),
    ...(input.organizationId ? { organization_id: input.organizationId } : {}),
    ...(input.organizationMembershipId
      ? { organization_membership_id: input.organizationMembershipId }
      : {}),
  };
  const hasClaims = Object.keys(claims).length > 0;
  if (userId && (role || roles.length > 0 || (input.permissions ?? []).length > 0 || hasClaims)) {
    return {
      kind: "user",
      userId,
      ...(tenantId ? { tenantId } : {}),
      ...(role ? { role } : roles[0] ? { role: roles[0] } : {}),
      roles,
      permissions: [...new Set(input.permissions ?? [])].sort(),
      token: {
        issuer: "dev-headers",
        audience: "dev",
        subject: userId,
        authProvider: "dev-headers",
      },
      ...(hasClaims ? { claims } : {}),
    };
  }
  return { kind: "anonymous" };
}

function parseHeaderList(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }
  } catch {
    // Fall through to comma-separated dev header parsing.
  }
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseClaims(value: string | null): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Invalid dev claims should not break the whole request; policies can still use explicit headers.
  }
  return undefined;
}

export function resolveAuthFromCli(input: CliAuthInput): AuthContext {
  return resolveAuthFromHeaders(input);
}

export function parseAuthHeaders(headers: Headers): AuthContext {
  return resolveAuthFromHeaders({
    userId: headers.get("x-forge-user-id") ?? undefined,
    tenantId: headers.get("x-forge-tenant-id") ?? undefined,
    organizationId: headers.get("x-forge-organization-id") ?? undefined,
    organizationMembershipId: headers.get("x-forge-organization-membership-id") ?? undefined,
    role: headers.get("x-forge-role") ?? undefined,
    roles: parseHeaderList(headers.get("x-forge-roles")),
    permissions: parseHeaderList(headers.get("x-forge-permissions")),
    claims: parseClaims(headers.get("x-forge-claims")),
  });
}

export function systemAuthFromSnapshot(
  snapshot: AuthContext,
  tenantId?: string,
): AuthContext {
  if (snapshot.kind === "user") {
    return {
      kind: "system",
      tenantId: tenantId ?? snapshot.tenantId,
      triggeredBy: snapshot,
    };
  }

  if (snapshot.kind === "system") {
    return {
      kind: "system",
      tenantId: tenantId ?? snapshot.tenantId,
      triggeredBy: snapshot.triggeredBy ?? snapshot,
    };
  }

  return {
    kind: "system",
    ...(tenantId ? { tenantId } : {}),
    triggeredBy: { kind: "anonymous" },
  };
}
