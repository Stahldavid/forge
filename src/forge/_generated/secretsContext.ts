// @forge-generated generator=0.1.0-alpha.9 input=8272d9166eb01c344388e0da68a01dbb2259b236af7b9fe5c7605e4a01ce57fc content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
