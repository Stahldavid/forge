// @forge-generated generator=0.1.0-alpha.10 input=0027e0819b107e3a91d36a3ebe496b8d70dd5bdf64c0d3399d8cc69acef3d5e3 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
