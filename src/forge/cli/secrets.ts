import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  checkSecrets,
  loadEnvSchema,
  loadSecretRegistry,
} from "../runtime/secrets/check.ts";
import { getRuntimeEnvStore, initializeRuntimeEnv } from "../runtime/context/create-context.ts";
import { redactSecretValue } from "../runtime/secrets/env-loader.ts";

export type SecretsSubcommand = "list" | "check" | "print" | "set" | "unset";

export interface SecretsCommandOptions {
  subcommand: SecretsSubcommand;
  workspaceRoot: string;
  json: boolean;
  redacted?: boolean;
  name?: string;
  value?: string;
}

export interface SecretsCommandResult {
  exitCode: 0 | 1;
  data?: unknown;
  diagnostics?: ReturnType<typeof createDiagnostic>[];
}

function parseEnvLocal(workspaceRoot: string): Record<string, string> {
  const path = join(workspaceRoot, ".env.local");
  if (!nodeFileSystem.exists(path)) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const rawLine of (nodeFileSystem.readText(path) ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return values;
}

function writeEnvLocal(workspaceRoot: string, values: Record<string, string>): void {
  const lines = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`);
  nodeFileSystem.writeText(join(workspaceRoot, ".env.local"), `${lines.join("\n")}\n`);
}

export async function runSecretsCommand(
  options: SecretsCommandOptions,
): Promise<SecretsCommandResult> {
  initializeRuntimeEnv(options.workspaceRoot);
  const registry = loadSecretRegistry(options.workspaceRoot);

  switch (options.subcommand) {
    case "list": {
      if (!registry) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: "missing secretRegistry.json; run forge generate first",
            }),
          ],
        };
      }
      return { exitCode: 0, data: registry };
    }
    case "check": {
      if (!registry) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: "missing secretRegistry.json; run forge generate first",
            }),
          ],
        };
      }

      const store = getRuntimeEnvStore(options.workspaceRoot);
      const result = checkSecrets(store, registry);
      return { exitCode: result.ok ? 0 : 1, data: result };
    }
    case "print": {
      if (!registry) {
        return { exitCode: 1, data: { secrets: [] } };
      }

      const store = getRuntimeEnvStore(options.workspaceRoot);
      const lines = registry.secrets.map((entry) => {
        const value = store.resolve(entry.name);
        const display =
          options.redacted && value
            ? redactSecretValue(value)
            : value
              ? "[set]"
              : "[missing]";
        return `${entry.name}=${display}`;
      });

      return { exitCode: 0, data: { lines } };
    }
    case "set": {
      if (!options.name || options.value === undefined) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_CLI_USAGE",
              message: "forge secrets set requires NAME and a value (pipe or arg)",
            }),
          ],
        };
      }

      const current = parseEnvLocal(options.workspaceRoot);
      current[options.name] = options.value;
      writeEnvLocal(options.workspaceRoot, current);
      initializeRuntimeEnv(options.workspaceRoot);
      return { exitCode: 0, data: { name: options.name, written: true } };
    }
    case "unset": {
      if (!options.name) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_CLI_USAGE",
              message: "forge secrets unset requires NAME",
            }),
          ],
        };
      }

      const current = parseEnvLocal(options.workspaceRoot);
      delete current[options.name];
      writeEnvLocal(options.workspaceRoot, current);
      initializeRuntimeEnv(options.workspaceRoot);
      return { exitCode: 0, data: { name: options.name, removed: true } };
    }
    default:
      return { exitCode: 1 };
  }
}

export function formatSecretsHuman(
  subcommand: SecretsSubcommand,
  result: SecretsCommandResult,
): string {
  if (result.diagnostics?.length) {
    return `${result.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`).join("\n")}\n`;
  }

  if (subcommand === "print" && result.data && typeof result.data === "object") {
    const lines = (result.data as { lines?: string[] }).lines ?? [];
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify(result.data, null, 2)}\n`;
}

export function formatSecretsJson(result: SecretsCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export type EnvSubcommand = "list" | "check" | "print";

export interface EnvCommandOptions {
  subcommand: EnvSubcommand;
  workspaceRoot: string;
  json: boolean;
  redacted?: boolean;
}

export async function runEnvCommand(options: EnvCommandOptions): Promise<SecretsCommandResult> {
  initializeRuntimeEnv(options.workspaceRoot);
  const schema = loadEnvSchema(options.workspaceRoot);

  switch (options.subcommand) {
    case "list":
      if (!schema) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: "missing envSchema.json; run forge generate first",
            }),
          ],
        };
      }
      return { exitCode: 0, data: schema };
    case "check": {
      if (!schema) {
        return {
          exitCode: 1,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: "FORGE_INSPECT_MISSING",
              message: "missing envSchema.json; run forge generate first",
            }),
          ],
        };
      }

      const store = getRuntimeEnvStore(options.workspaceRoot);
      const missing = schema.variables
        .filter((variable) => variable.required)
        .filter((variable) => {
          const value = store.resolve(variable.name);
          return !value || value.length === 0;
        })
        .map((variable) => variable.name);

      return {
        exitCode: missing.length === 0 ? 0 : 1,
        data: { ok: missing.length === 0, missing },
      };
    }
    case "print": {
      if (!schema) {
        return { exitCode: 0, data: { variables: [] } };
      }

      const store = getRuntimeEnvStore(options.workspaceRoot);
      const lines = schema.variables.map((variable) => {
        const value = store.resolve(variable.name);
        const display =
          variable.kind === "secret" && options.redacted && value
            ? redactSecretValue(value)
            : value
              ? variable.kind === "secret"
                ? "[set]"
                : value
              : "[missing]";
        return `${variable.name} (${variable.kind})=${display}`;
      });

      return { exitCode: 0, data: { lines } };
    }
    default:
      return { exitCode: 1 };
  }
}

export function formatEnvHuman(subcommand: EnvSubcommand, result: SecretsCommandResult): string {
  if (result.diagnostics?.length) {
    return `${result.diagnostics.map((d) => `${d.severity} ${d.code}: ${d.message}`).join("\n")}\n`;
  }

  if (subcommand === "print" && result.data && typeof result.data === "object") {
    const lines = (result.data as { lines?: string[] }).lines ?? [];
    return `${lines.join("\n")}\n`;
  }

  return `${JSON.stringify(result.data, null, 2)}\n`;
}

export function formatEnvJson(result: SecretsCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}
