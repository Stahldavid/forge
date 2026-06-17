// @forge-generated generator=0.1.0-alpha.9 input=f8247c48f65f765e34269321a93a803b5c3f6b43c92841fd1bc009e13eee2a31 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
