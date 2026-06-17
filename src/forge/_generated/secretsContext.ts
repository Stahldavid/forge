// @forge-generated generator=0.1.0-alpha.8 input=f772dc4340a6b12abe01e0d960539c3f9ee1708c106f8d98108b06b0dc708960 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
