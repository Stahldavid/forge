import type { AuthContext } from "./types.ts";

export interface AuthHeaderInput {
  userId?: string;
  tenantId?: string;
  role?: string;
}

export interface CliAuthInput {
  userId?: string;
  tenantId?: string;
  role?: string;
}

export function resolveAuthFromHeaders(input: AuthHeaderInput): AuthContext {
  const { userId, tenantId, role } = input;
  if (userId && tenantId && role) {
    return {
      kind: "user",
      userId,
      tenantId,
      role,
      roles: [role],
      permissions: [],
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

export function resolveAuthFromCli(input: CliAuthInput): AuthContext {
  return resolveAuthFromHeaders(input);
}

export function parseAuthHeaders(headers: Headers): AuthContext {
  return resolveAuthFromHeaders({
    userId: headers.get("x-forge-user-id") ?? undefined,
    tenantId: headers.get("x-forge-tenant-id") ?? undefined,
    role: headers.get("x-forge-role") ?? undefined,
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
