// @forge-generated generator=0.1.0-alpha.13 input=4014caa977eff4a37c3ff6c255f595e2ae9f80b25fb6970482fd60ba5a7cf3b6 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
