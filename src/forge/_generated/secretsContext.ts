// @forge-generated generator=0.1.0-alpha.0 input=91d8894f322b8dd604714d7b26a8bac3b5bbb0904d62cc0e2761ba21098e1537 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
