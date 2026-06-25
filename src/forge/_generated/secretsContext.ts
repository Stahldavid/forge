// @forge-generated generator=0.1.0-alpha.27 input=c421aa52eea72a123ad08deaf57d3e0438100460fc40d12edf5d5fe2fff0e58f content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
