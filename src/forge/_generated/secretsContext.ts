// @forge-generated generator=0.1.0-alpha.68 input=eb85ce79777e8854119a312edd29262099578bdd5f8be82c03b5f0caae80f391 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
