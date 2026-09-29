// @forge-generated generator=0.1.0-alpha.67 input=2dc11ae4fcaef4dfc0d05d4b3ca83648da1b99e5202fd8001032014aaa6e9342 content=cf170e035d456c3ac698211e5b5a5b65a5743332654a8d5987281c050002cf99
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
