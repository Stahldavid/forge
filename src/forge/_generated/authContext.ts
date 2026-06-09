// @forge-generated generator=0.0.0 input=a364a2ec435f1ad252c1d418c40d3d787ffd94db8ab078dc670d129e1ab2d4fd content=b1a42bda2c7bc6922a9cc83b8586cda9377d9f18a5feb5c4bf5c2f1953e80d07
export type AuthContext =
  | { kind: "user"; userId: string; tenantId: string; role: string; permissions?: string[] }
  | { kind: "system"; tenantId?: string; triggeredBy?: { userId?: string; tenantId?: string; role?: string } }
  | { kind: "anonymous" };
