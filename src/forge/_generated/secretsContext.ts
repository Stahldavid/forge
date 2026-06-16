// @forge-generated generator=0.1.0-alpha.3 input=036146e3c770368a0d71d33e4eff9252acb5ea90669f57bf119dcb1cb4b4e379 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
