export type AuthContext =
  | {
      kind: "user";
      userId: string;
      tenantId: string;
      role: string;
      permissions?: string[];
    }
  | {
      kind: "system";
      tenantId?: string;
      triggeredBy?: {
        userId?: string;
        tenantId?: string;
        role?: string;
        kind?: string;
      };
    }
  | { kind: "anonymous" };

export type AuthSnapshot = AuthContext;

export function isUserAuth(auth: AuthContext): auth is Extract<AuthContext, { kind: "user" }> {
  return auth.kind === "user";
}

export function isSystemAuth(auth: AuthContext): auth is Extract<AuthContext, { kind: "system" }> {
  return auth.kind === "system";
}

export function snapshotAuth(auth: AuthContext): AuthSnapshot {
  if (auth.kind === "user") {
    return {
      kind: "user",
      userId: auth.userId,
      tenantId: auth.tenantId,
      role: auth.role,
      ...(auth.permissions ? { permissions: auth.permissions } : {}),
    };
  }

  if (auth.kind === "system") {
    return {
      kind: "system",
      ...(auth.tenantId ? { tenantId: auth.tenantId } : {}),
      ...(auth.triggeredBy ? { triggeredBy: auth.triggeredBy } : {}),
    };
  }

  return { kind: "anonymous" };
}
