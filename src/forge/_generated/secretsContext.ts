// @forge-generated generator=0.1.0-alpha.25 input=93e9f4f72ca6f1bde1a9ff909c546319cbcfd3965c2a9f4099c06e0c81dbab7a content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
