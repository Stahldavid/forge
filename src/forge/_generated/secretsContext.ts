// @forge-generated generator=0.0.0 input=a364a2ec435f1ad252c1d418c40d3d787ffd94db8ab078dc670d129e1ab2d4fd content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
