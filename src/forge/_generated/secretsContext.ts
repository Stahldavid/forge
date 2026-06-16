// @forge-generated generator=0.1.0-alpha.3 input=6dc781b214af0d93cf64272aa15238cf3892cf6832c719080821b21888a3bda9 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
