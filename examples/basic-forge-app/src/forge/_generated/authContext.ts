// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=b1a42bda2c7bc6922a9cc83b8586cda9377d9f18a5feb5c4bf5c2f1953e80d07
export type AuthContext =
  | { kind: "user"; userId: string; tenantId: string; role: string; permissions?: string[] }
  | { kind: "system"; tenantId?: string; triggeredBy?: { userId?: string; tenantId?: string; role?: string } }
  | { kind: "anonymous" };
