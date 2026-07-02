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

export type SecretsSubcommand = "list" | "check" | "print" | "set" | "unset" | "prove";

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
    case "prove": {
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
      return {
        exitCode: result.ok ? 0 : 1,
        data: {
          schemaVersion: "0.1.0",
          kind: "secrets-proof",
          ok: result.ok,
          invariants: [
            {
              id: "INV-008",
              name: "secret values are not emitted by the proof",
              status: "passed",
              evidence: "only names, missing names, and redacted presence markers are returned",
            },
            {
              id: "INV-008-REQUIRED",
              name: "required secrets are configured",
              status: result.ok ? "passed" : "failed",
              evidence: {
                missing: result.missing,
                present: result.present.map((entry) => ({
                  name: entry.name,
                  redacted: entry.redacted,
                })),
              },
            },
          ],
        },
      };
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

export type EnvSubcommand = "list" | "check" | "print" | "doctor";
export type EnvDoctorTarget = "local" | "staging" | "production";

export interface EnvCommandOptions {
  subcommand: EnvSubcommand;
  workspaceRoot: string;
  json: boolean;
  redacted?: boolean;
  target?: EnvDoctorTarget;
}

const ENV_DOCTOR_KEYS = [
  "DATABASE_URL",
  "FORGE_AUTH_MODE",
  "FORGE_AUTH_ISSUER",
  "FORGE_AUTH_AUDIENCE",
  "FORGE_AUTH_JWKS_URI",
  "FORGE_AUTH_DISCOVERY_URL",
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
  "WORKOS_POST_LOGIN_REDIRECT_URI",
  "WORKOS_POST_LOGOUT_REDIRECT_URI",
  "WORKOS_WEBHOOK_SECRET",
] as const;

function parseEnvFile(workspaceRoot: string, relative: string): Record<string, string> {
  const path = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(path)) return {};
  const values: Record<string, string> = {};
  for (const rawLine of (nodeFileSystem.readText(path) ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const rawValue = line.slice(eq + 1).trim();
    values[line.slice(0, eq).trim()] = rawValue.replace(/^["']|["']$/g, "");
  }
  return values;
}

function envDoctorFiles(target: EnvDoctorTarget): string[] {
  if (target === "production") return ["deploy/.env.production"];
  if (target === "staging") return ["deploy/.env.staging", ".env.staging"];
  return [".env", ".env.local"];
}

function hasWorkOSAppArtifacts(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, "workos-seed.yml")) ||
    nodeFileSystem.exists(join(workspaceRoot, "src/policies.workos.ts")) ||
    nodeFileSystem.exists(join(workspaceRoot, "src/forge/_generated/integrations/workos/auth-routes.ts"));
}

function envDoctor(options: EnvCommandOptions): SecretsCommandResult {
  const target = options.target ?? "local";
  const files = envDoctorFiles(target).map((path) => {
    const values = parseEnvFile(options.workspaceRoot, path);
    return {
      path,
      present: nodeFileSystem.exists(join(options.workspaceRoot, path)),
      keys: Object.keys(values).filter((key) => ENV_DOCTOR_KEYS.includes(key as (typeof ENV_DOCTOR_KEYS)[number])).sort(),
      values,
    };
  });
  const processValues = Object.fromEntries(
    ENV_DOCTOR_KEYS.filter((key) => Boolean(process.env[key])).map((key) => [key, process.env[key]!]),
  );
  const effective = {
    ...Object.assign({}, ...files.map((file) => file.values)),
    ...processValues,
  } as Record<string, string>;
  const required = target === "production"
    ? ["DATABASE_URL", "FORGE_AUTH_MODE", "FORGE_AUTH_ISSUER", "FORGE_AUTH_AUDIENCE"]
    : ["FORGE_AUTH_MODE"];
  const missing = required.filter((key) => !effective[key]);
  const authMode = effective.FORGE_AUTH_MODE ?? "dev-headers";
  const productionAuth = authMode === "jwt" || authMode === "oidc";
  const database = effective.DATABASE_URL
    ? "postgres"
    : target === "production"
      ? "missing"
      : "local-dev";
  const workosDetected = hasWorkOSAppArtifacts(options.workspaceRoot) ||
    Boolean(effective.WORKOS_CLIENT_ID || effective.WORKOS_API_KEY);
  const provider = workosDetected ? "workos" : "none";
  const hasJwtSource = Boolean(effective.FORGE_AUTH_JWKS_URI || effective.FORGE_AUTH_DISCOVERY_URL);
  const blockers = [
    ...missing.filter((key) => key !== "DATABASE_URL").map((key) => `${key} missing`),
    ...(target === "production" && !productionAuth ? [`FORGE_AUTH_MODE=${authMode} is not production auth`] : []),
    ...(target === "production" && database === "missing" ? ["DATABASE_URL missing"] : []),
    ...(target === "production" && productionAuth && !hasJwtSource
      ? ["FORGE_AUTH_JWKS_URI or FORGE_AUTH_DISCOVERY_URL missing"]
      : []),
    ...(target === "production" && workosDetected && !effective.WORKOS_CLIENT_ID ? ["WORKOS_CLIENT_ID missing"] : []),
    ...(target === "production" && workosDetected && !effective.WORKOS_API_KEY ? ["WORKOS_API_KEY missing"] : []),
  ];
  const warnings = [
    ...(target === "production" && files.every((file) => !file.present)
      ? ["deploy/.env.production not found; process.env alone may be fine in CI but is easy for agents to miss"]
      : []),
    ...(workosDetected && !effective.WORKOS_COOKIE_PASSWORD ? ["WORKOS_COOKIE_PASSWORD missing"] : []),
    ...(workosDetected && !effective.WORKOS_REDIRECT_URI ? ["WORKOS_REDIRECT_URI missing"] : []),
  ];
  return {
    exitCode: blockers.length === 0 ? 0 : 1,
    data: {
      schemaVersion: "0.1.0",
      kind: "env-doctor",
      ok: blockers.length === 0,
      target,
      authMode,
      productionAuth,
      database,
      provider,
      sources: [
        {
          path: "process.env",
          present: Object.keys(processValues).length > 0,
          keys: Object.keys(processValues).sort(),
          values: undefined,
        },
        ...files.map(({ path, present, keys }) => ({ path, present, keys })),
      ],
      present: ENV_DOCTOR_KEYS.filter((key) => Boolean(effective[key])).sort(),
      missing,
      blockers,
      warnings,
      nextActions: blockers.length === 0
        ? ["forge deploy readiness --production --json"]
        : target === "production"
          ? ["cp deploy/.env.production.example deploy/.env.production", "forge env doctor --target production --json"]
          : ["forge env doctor --target local --json"],
    },
  };
}

export async function runEnvCommand(options: EnvCommandOptions): Promise<SecretsCommandResult> {
  initializeRuntimeEnv(options.workspaceRoot);
  const schema = loadEnvSchema(options.workspaceRoot);

  switch (options.subcommand) {
    case "doctor":
      return envDoctor(options);
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
