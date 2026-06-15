// @forge-generated generator=0.1.0-alpha.0 input=4dbda59592f3ea3b2e8992aa95fec54fd7f948fb5fcacf9a05a77ed0f3792761 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
