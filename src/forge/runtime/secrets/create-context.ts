import {
  FORGE_ENV_UNKNOWN_REQUIRED,
  FORGE_SECRET_FORBIDDEN_CONTEXT,
  FORGE_SECRET_MISSING,
} from "../../compiler/diagnostics/codes.ts";
import type { RuntimeContext } from "../../compiler/types/runtime.ts";
import type {
  ConfigContext,
  CreateConfigContextOptions,
  CreateSecretsContextOptions,
  SecretsContext,
} from "./types.ts";

const SECRETS_FORBIDDEN: RuntimeContext[] = [
  "command",
  "client",
  "query",
  "liveQuery",
];

function forgeError(code: string, message: string): never {
  const error = new Error(message);
  (error as Error & { code: string }).code = code;
  throw error;
}

export function secretsForbiddenInContext(runtimeKind: RuntimeContext): boolean {
  return SECRETS_FORBIDDEN.includes(runtimeKind);
}

export function createSecretsContext(
  options: CreateSecretsContextOptions,
): SecretsContext {
  const { store, registryNames, runtimeKind, requiredSecrets = [] } = options;

  if (secretsForbiddenInContext(runtimeKind)) {
    return {
      get(name: string): string {
        forgeError(
          FORGE_SECRET_FORBIDDEN_CONTEXT,
          `ctx.secrets.get('${name}') is forbidden in '${runtimeKind}' context`,
        );
      },
      optional(_name: string): string | undefined {
        return undefined;
      },
      has(_name: string): boolean {
        return false;
      },
    };
  }

  function resolve(name: string): string | undefined {
    return store.resolve(name);
  }

  return {
    get(name: string): string {
      const value = resolve(name);
      if (value !== undefined && value.length > 0) {
        return value;
      }

      const required =
        requiredSecrets.find((entry) => entry.name === name)?.required ??
        registryNames.has(name);

      if (required) {
        forgeError(
          FORGE_SECRET_MISSING,
          `required secret '${name}' is not set`,
        );
      }

      forgeError(FORGE_SECRET_MISSING, `secret '${name}' is not set`);
    },
    optional(name: string): string | undefined {
      const value = resolve(name);
      return value && value.length > 0 ? value : undefined;
    },
    has(name: string): boolean {
      const value = resolve(name);
      return value !== undefined && value.length > 0;
    },
  };
}

export function createConfigContext(options: CreateConfigContextOptions): ConfigContext {
  const { store, schema, runtimeKind } = options;
  const schemaByName = new Map(schema.map((entry) => [entry.name, entry]));

  function resolve(name: string): string | undefined {
    return store.resolve(name);
  }

  return {
    get(name: string): string {
      const entry = schemaByName.get(name);
      const value = resolve(name);

      if (value !== undefined && value.length > 0) {
        if (
          entry?.kind === "secret" &&
          secretsForbiddenInContext(runtimeKind) &&
          runtimeKind === "command"
        ) {
          forgeError(
            FORGE_SECRET_FORBIDDEN_CONTEXT,
            `secret config '${name}' is not allowed in '${runtimeKind}' context`,
          );
        }
        return value;
      }

      if (entry?.required) {
        forgeError(
          FORGE_ENV_UNKNOWN_REQUIRED,
          `required config '${name}' is not set`,
        );
      }

      forgeError(FORGE_ENV_UNKNOWN_REQUIRED, `config '${name}' is not set`);
    },
    optional(name: string): string | undefined {
      const entry = schemaByName.get(name);
      if (
        entry?.kind === "secret" &&
        secretsForbiddenInContext(runtimeKind) &&
        runtimeKind === "command"
      ) {
        return undefined;
      }

      const value = resolve(name);
      return value && value.length > 0 ? value : undefined;
    },
  };
}
