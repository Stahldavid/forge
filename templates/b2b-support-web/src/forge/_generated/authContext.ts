// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=b1a42bda2c7bc6922a9cc83b8586cda9377d9f18a5feb5c4bf5c2f1953e80d07
export type AuthContext =
  | { kind: "user"; userId: string; tenantId: string; role: string; permissions?: string[] }
  | { kind: "system"; tenantId?: string; triggeredBy?: { userId?: string; tenantId?: string; role?: string } }
  | { kind: "anonymous" };
