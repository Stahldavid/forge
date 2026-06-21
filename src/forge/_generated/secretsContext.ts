// @forge-generated generator=0.1.0-alpha.18 input=d037a38973574e99c5c6fe2374b25cddbe8b19b9f673974d1f9f4858c3f8b03b content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
