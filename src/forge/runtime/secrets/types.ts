import type { RuntimeContext } from "../../compiler/types/runtime.ts";

export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
  loadedFiles: string[];
  resolve(name: string): string | undefined;
  snapshot(): Record<string, string | undefined>;
}

export interface CreateSecretsContextOptions {
  store: RuntimeEnvStore;
  registryNames: Set<string>;
  runtimeKind: RuntimeContext;
  requiredSecrets?: { name: string; required: boolean }[];
}

export interface CreateConfigContextOptions {
  store: RuntimeEnvStore;
  schema: { name: string; kind: "secret" | "config"; required: boolean }[];
  runtimeKind: RuntimeContext;
}
