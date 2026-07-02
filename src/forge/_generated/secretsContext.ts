// @forge-generated generator=0.1.0-alpha.47 input=bebb010a880143584f74a6be9a4ef8e76d626cc1fd3f32b688b9a669679791c1 content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
