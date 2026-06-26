// @forge-generated generator=0.1.0-alpha.28 input=e732f729a92a1ffcaf34b4c696c5efcf65cf697fe11fb071ee16145fdd73e88c content=f4fb41702a4aa53e0f1783707d82dd624e374d9f753ca2cd0092af42d050d4de
export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
