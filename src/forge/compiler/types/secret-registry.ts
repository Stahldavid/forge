import type { RuntimeContext } from "./runtime.ts";

export interface SecretRegistryEntry {
  name: string;
  required: boolean;
  source: "recipe" | "signature" | "jsdoc" | "rule" | "readme";
  integration?: string;
  allowedContexts: RuntimeContext[];
  public?: boolean;
}

export interface SecretRegistry {
  secrets: SecretRegistryEntry[];
}

export interface EnvVariable {
  name: string;
  kind: "secret" | "config";
  required: boolean;
  source: string;
  integration?: string;
  public?: boolean;
}

export interface EnvSchema {
  variables: EnvVariable[];
}

export interface ConfigRegistryEntry {
  name: string;
  required: boolean;
  source: string;
  integration?: string;
}

export interface ConfigRegistry {
  configs: ConfigRegistryEntry[];
}
