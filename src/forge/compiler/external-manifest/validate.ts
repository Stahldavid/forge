import { createDiagnostic } from "../diagnostics/create.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import {
  FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION,
  type ForgeExternalEntryKind,
  type ForgeExternalEntryRisk,
  type ForgeExternalManifest,
  type ForgeExternalManifestEntry,
  type ForgeExternalManifestRegistryFile,
  type ForgeExternalTransportKind,
  type ForgeExternalTransactionMode,
} from "./types.ts";

const TRANSPORTS: ForgeExternalTransportKind[] = ["http", "grpc", "stdio"];
const ENTRY_KINDS: ForgeExternalEntryKind[] = ["command", "query"];
const RISKS: ForgeExternalEntryRisk[] = ["read", "write", "destructive", "external"];
const TRANSACTIONS: ForgeExternalTransactionMode[] = [
  "read-only",
  "external-managed",
  "forge-managed",
  "saga",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function commandArgsArray(value: unknown): value is string[] {
  return Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === "string" &&
    value[0].length > 0 &&
    value.every((item) => typeof item === "string");
}

function externalDiagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
  fixHint?: string,
): Diagnostic {
  return createDiagnostic({
    severity,
    code,
    message,
    ...(file ? { file } : {}),
    ...(fixHint ? { fixHint } : {}),
    docs: ["docs/forge-protocol.md", "schemas/forge-manifest.schema.json"],
  });
}

function validateEntry(
  entry: unknown,
  index: number,
  serviceName: string,
  diagnostics: Diagnostic[],
  file?: string,
): ForgeExternalManifestEntry | null {
  if (!isObject(entry)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_OBJECT",
      `external manifest entry at index ${index} must be an object`,
      file,
    ));
    return null;
  }

  const name = entry.name;
  const kind = entry.kind;
  if (!isString(name)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_NAME",
      `external manifest entry at index ${index} must have a non-empty name`,
      file,
    ));
  }
  if (!ENTRY_KINDS.includes(kind as ForgeExternalEntryKind)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_KIND",
      `external manifest entry '${String(name || index)}' must be kind command or query`,
      file,
    ));
  }
  if (entry.effects !== undefined && !stringArray(entry.effects)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_EFFECTS",
      `external manifest entry '${String(name || index)}' effects must be a string array`,
      file,
    ));
  }
  if (entry.risk !== undefined && !RISKS.includes(entry.risk as ForgeExternalEntryRisk)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_RISK",
      `external manifest entry '${String(name || index)}' has unsupported risk '${String(entry.risk)}'`,
      file,
    ));
  }
  if (
    entry.transaction !== undefined &&
    !TRANSACTIONS.includes(entry.transaction as ForgeExternalTransactionMode)
  ) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRY_TRANSACTION",
      `external manifest entry '${String(name || index)}' has unsupported transaction mode '${String(entry.transaction)}'`,
      file,
    ));
  }
  if (
    entry.kind === "query" &&
    entry.transaction !== undefined &&
    entry.transaction !== "read-only"
  ) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_QUERY_TRANSACTION",
      `external query '${serviceName}.${String(name)}' must use transaction read-only when transaction is declared`,
      file,
      "Declare command for writes, or set transaction to read-only for external queries.",
    ));
  }
  if (entry.kind === "query" && entry.risk !== undefined && entry.risk !== "read") {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_QUERY_RISK",
      `external query '${serviceName}.${String(name)}' must use risk read when risk is declared`,
      file,
    ));
  }

  if (!isString(name) || !ENTRY_KINDS.includes(kind as ForgeExternalEntryKind)) {
    return null;
  }

  return {
    name,
    kind: kind as ForgeExternalEntryKind,
    ...(isString(entry.description) ? { description: entry.description } : {}),
    ...(isString(entry.path) ? { path: entry.path } : {}),
    ...(entry.method === "GET" || entry.method === "POST" ? { method: entry.method } : {}),
    ...(entry.inputSchema !== undefined ? { inputSchema: entry.inputSchema } : {}),
    ...(entry.outputSchema !== undefined ? { outputSchema: entry.outputSchema } : {}),
    ...(isString(entry.policy) ? { policy: entry.policy } : {}),
    ...(typeof entry.tenantScoped === "boolean" ? { tenantScoped: entry.tenantScoped } : {}),
    ...(TRANSACTIONS.includes(entry.transaction as ForgeExternalTransactionMode)
      ? { transaction: entry.transaction as ForgeExternalTransactionMode }
      : {}),
    ...(RISKS.includes(entry.risk as ForgeExternalEntryRisk)
      ? { risk: entry.risk as ForgeExternalEntryRisk }
      : {}),
    ...(typeof entry.needsApproval === "boolean" ? { needsApproval: entry.needsApproval } : {}),
    ...(stringArray(entry.effects) ? { effects: entry.effects } : {}),
  };
}

export function validateExternalManifest(
  value: unknown,
  options: { file?: string } = {},
): { manifest: ForgeExternalManifest | null; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  if (!isObject(value)) {
    return {
      manifest: null,
      diagnostics: [
        externalDiagnostic(
          "error",
          "FORGE_EXTERNAL_MANIFEST_OBJECT",
          "forge external manifest must be a JSON object",
          options.file,
        ),
      ],
    };
  }

  if (value.forgeProtocol !== FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_PROTOCOL_VERSION",
      `forgeProtocol must be '${FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION}'`,
      options.file,
    ));
  }
  if (!isString(value.language)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_LANGUAGE",
      "external manifest must declare a non-empty language",
      options.file,
    ));
  }
  if (!isObject(value.service)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE",
      "external manifest must declare a service object",
      options.file,
    ));
  }
  if (!Array.isArray(value.entries)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_ENTRIES",
      "external manifest must declare an entries array",
      options.file,
    ));
  }

  const service = isObject(value.service) ? value.service : {};
  if (!isString(service.name)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE_NAME",
      "external service must have a non-empty name",
      options.file,
    ));
  }
  if (!TRANSPORTS.includes(service.transport as ForgeExternalTransportKind)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE_TRANSPORT",
      `external service '${String(service.name || "unknown")}' must use transport http, grpc, or stdio`,
      options.file,
    ));
  }
  if (service.transport === "http" && !isString(service.baseUrl)) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE_BASE_URL",
      `external service '${String(service.name || "unknown")}' uses http transport and must declare a non-empty baseUrl`,
      options.file,
      "Set service.baseUrl to the external runtime base URL.",
    ));
  }
  const hasCommand = isString(service.command);
  const hasCommandArgs = commandArgsArray(service.commandArgs);
  if (service.commandArgs !== undefined && !hasCommandArgs) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE_COMMAND_ARGS",
      `external service '${String(service.name || "unknown")}' commandArgs must be a non-empty string array`,
      options.file,
      "Set service.commandArgs to an array whose first item is the executable.",
    ));
  }
  if (service.transport === "stdio" && !hasCommand && !hasCommandArgs) {
    diagnostics.push(externalDiagnostic(
      "error",
      "FORGE_EXTERNAL_SERVICE_COMMAND",
      `external service '${String(service.name || "unknown")}' uses stdio transport and must declare a non-empty command or commandArgs`,
      options.file,
      "Set service.command to a command line string or service.commandArgs to a structured executable/args array.",
    ));
  }

  const entries = Array.isArray(value.entries)
    ? value.entries
      .map((entry, index) => validateEntry(entry, index, String(service.name || "unknown"), diagnostics, options.file))
      .filter((entry): entry is ForgeExternalManifestEntry => entry !== null)
    : [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.name}`;
    if (seen.has(key)) {
      diagnostics.push(externalDiagnostic(
        "error",
        "FORGE_EXTERNAL_ENTRY_DUPLICATE",
        `external service '${String(service.name)}' declares duplicate ${entry.kind} '${entry.name}'`,
        options.file,
      ));
    }
    seen.add(key);
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { manifest: null, diagnostics };
  }

  return {
    manifest: {
      forgeProtocol: FORGE_EXTERNAL_MANIFEST_PROTOCOL_VERSION,
      language: value.language as ForgeExternalManifest["language"],
      ...(isString(value.framework) ? { framework: value.framework } : {}),
      service: {
        name: service.name as string,
        transport: service.transport as ForgeExternalTransportKind,
        ...(isString(service.baseUrl) ? { baseUrl: service.baseUrl } : {}),
        ...(hasCommand ? { command: service.command as string } : {}),
        ...(hasCommandArgs ? { commandArgs: service.commandArgs as string[] } : {}),
        ...(isString(service.health) ? { health: service.health } : {}),
      },
      entries,
      ...(isObject(value.schemas) ? { schemas: value.schemas } : {}),
    },
    diagnostics,
  };
}

export function validateExternalManifestRegistry(
  value: unknown,
  options: { file?: string } = {},
): { registry: ForgeExternalManifestRegistryFile | null; diagnostics: Diagnostic[] } {
  if (!isObject(value)) {
    return {
      registry: null,
      diagnostics: [
        externalDiagnostic(
          "error",
          "FORGE_EXTERNAL_REGISTRY_OBJECT",
          "external manifest registry must be a JSON object",
          options.file,
        ),
      ],
    };
  }
  if (value.schemaVersion !== "0.1.0") {
    return {
      registry: null,
      diagnostics: [
        externalDiagnostic(
          "error",
          "FORGE_EXTERNAL_REGISTRY_VERSION",
          "external manifest registry schemaVersion must be '0.1.0'",
          options.file,
        ),
      ],
    };
  }
  if (!Array.isArray(value.manifests)) {
    return {
      registry: null,
      diagnostics: [
        externalDiagnostic(
          "error",
          "FORGE_EXTERNAL_REGISTRY_MANIFESTS",
          "external manifest registry must include a manifests array",
          options.file,
        ),
      ],
    };
  }

  const diagnostics: Diagnostic[] = [];
  const manifests: ForgeExternalManifest[] = [];
  for (const [index, manifestValue] of value.manifests.entries()) {
    const result = validateExternalManifest(manifestValue, {
      file: options.file ? `${options.file}#manifests/${index}` : undefined,
    });
    diagnostics.push(...result.diagnostics);
    if (result.manifest) {
      manifests.push(result.manifest);
    }
  }
  return {
    registry: diagnostics.some((diagnostic) => diagnostic.severity === "error")
      ? null
      : { schemaVersion: "0.1.0", manifests },
    diagnostics,
  };
}
