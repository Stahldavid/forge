export type AuthContext =
  | {
      kind: "user";
      userId: string;
      tenantId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
      email?: string;
      name?: string;
      token?: {
        issuer: string;
        audience: string | string[];
        subject: string;
        expiresAt?: number;
        issuedAt?: number;
        authProvider: string;
      };
      claims?: Record<string, unknown>;
    }
  | {
      kind: "system";
      tenantId?: string;
      triggeredBy?: AuthSnapshot;
    }
  | { kind: "anonymous" };

export type AuthSnapshot =
  | {
      kind: "user";
      userId: string;
      tenantId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
      email?: string;
      name?: string;
      token?: {
        issuer: string;
        audience: string | string[];
        subject: string;
        expiresAt?: number;
        issuedAt?: number;
        authProvider: string;
      };
      claims?: Record<string, unknown>;
    }
  | {
      kind: "system";
      tenantId?: string;
      triggeredBy?: AuthSnapshot;
    }
  | { kind: "anonymous" };

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
      ...(auth.tenantId ? { tenantId: auth.tenantId } : {}),
      ...(auth.role ? { role: auth.role } : {}),
      ...(auth.roles ? { roles: auth.roles } : {}),
      ...(auth.permissions ? { permissions: auth.permissions } : {}),
      ...(auth.email ? { email: auth.email } : {}),
      ...(auth.name ? { name: auth.name } : {}),
      ...(auth.token ? { token: auth.token } : {}),
      ...(auth.claims ? { claims: auth.claims } : {}),
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
