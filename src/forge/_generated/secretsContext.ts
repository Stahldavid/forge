// @forge-generated generator=0.1.0-alpha.63 input=84e91710081b76fb63c11fe704185090832d0113ff972e147f9de33e12dd16f7 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
