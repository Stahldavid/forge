// @forge-generated generator=0.1.0-alpha.65 input=dbf2c962fa9cf8e2fa9dc988c6cf3a4e462e8f7dd759f143418b9538a08f4a85 content=cf170e035d456c3ac698211e5b5a5b65a5743332654a8d5987281c050002cf99
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
  | { kind: "system"; tenantId?: string; triggeredBy?: AuthContext }
  | { kind: "anonymous" };
