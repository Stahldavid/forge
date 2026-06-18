// @forge-generated generator=0.1.0-alpha.14 input=a43a0684c37e2ef6e7bce4adf441dbc821a8de9a5fa05aca373a8dd420940b7d content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
