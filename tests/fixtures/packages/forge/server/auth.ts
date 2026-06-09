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
