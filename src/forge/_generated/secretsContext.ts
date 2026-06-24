// @forge-generated generator=0.1.0-alpha.20 input=52fbf6548db00164619ce319c27000e8c901cb8b66be95b11e809827b08dee89 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
