// @forge-generated generator=0.1.0-alpha.0 input=01d6a3848650ea2a03ea8e037b400dc6497d1527c05345535ef5080132d7aabb content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
