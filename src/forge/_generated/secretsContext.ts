// @forge-generated generator=0.1.0-alpha.3 input=0ece0560c9d3676ff4363aaf8d954bb17be20b06abcc4e0e01c2e2bd0e69e106 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
