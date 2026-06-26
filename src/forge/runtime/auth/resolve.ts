import type { AuthContext } from "./types.ts";

export interface AuthHeaderInput {
  userId?: string;
  tenantId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
}

export interface CliAuthInput {
  userId?: string;
  tenantId?: string;
  role?: string;
  roles?: string[];
  permissions?: string[];
}

export function resolveAuthFromHeaders(input: AuthHeaderInput): AuthContext {
  const { userId, tenantId, role } = input;
  const roles = [...new Set([...(role ? [role] : []), ...(input.roles ?? [])])];
  if (userId && (role || roles.length > 0 || (input.permissions ?? []).length > 0)) {
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
      claims: {},
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

export function resolveAuthFromCli(input: CliAuthInput): AuthContext {
  return resolveAuthFromHeaders(input);
}

export function parseAuthHeaders(headers: Headers): AuthContext {
  return resolveAuthFromHeaders({
    userId: headers.get("x-forge-user-id") ?? undefined,
    tenantId: headers.get("x-forge-tenant-id") ?? undefined,
    role: headers.get("x-forge-role") ?? undefined,
    roles: parseHeaderList(headers.get("x-forge-roles")),
    permissions: parseHeaderList(headers.get("x-forge-permissions")),
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
