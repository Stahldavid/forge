// @forge-generated generator=0.1.0-alpha.63 input=cefae73a286f2c10ee10ee59b0d06dd93a157cd7085a48f2f9e097d8c03c61a3 content=cf170e035d456c3ac698211e5b5a5b65a5743332654a8d5987281c050002cf99
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
