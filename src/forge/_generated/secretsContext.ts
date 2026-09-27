// @forge-generated generator=0.1.0-alpha.63 input=826e266f4ac7c916cfc1cf8a75cf40c6617710076c778159ef594d9636da98d9 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
