// @forge-generated generator=0.1.0-alpha.66 input=57341432921f2c43eddb033a05cc7ad25dabd9813fcf2fd64c67f74ae5f61859 content=cf170e035d456c3ac698211e5b5a5b65a5743332654a8d5987281c050002cf99
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
