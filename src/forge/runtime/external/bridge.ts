import { spawn } from "node:child_process";
import { join } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_EXTERNAL_RUNTIME_BAD_RESPONSE,
  FORGE_EXTERNAL_RUNTIME_FAILED,
  FORGE_EXTERNAL_RUNTIME_NOT_FOUND,
  FORGE_EXTERNAL_RUNTIME_UNSUPPORTED,
} from "../../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import type {
  ForgeExternalService,
  ForgeExternalServiceEntry,
  ForgeExternalServiceGraph,
} from "../../compiler/external-manifest/types.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { QueryDefinition } from "../../compiler/types/query-registry.ts";
import type { RuntimeEntry } from "../../compiler/types/runtime-graph.ts";
import type { AuthContext } from "../auth/types.ts";
import { snapshotAuth } from "../auth/types.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { checkCommandPolicy, checkQueryPolicy } from "../policy/check.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { generateRequestId, generateTraceId } from "../telemetry/correlation.ts";

export interface ExternalRuntimeCall {
  kind: "command" | "query";
  serviceName: string;
  entryName: string;
  args?: unknown;
  auth?: AuthContext;
  requestHeaders?: Headers;
  requestId?: string;
}

export interface ExternalRuntimeResult {
  ok: boolean;
  result?: unknown;
  diagnostics: Diagnostic[];
  traceId: string;
  exitCode: 0 | 1;
  service?: ForgeExternalService;
  entry?: ForgeExternalServiceEntry;
}

interface ExternalEnvelope {
  ok?: boolean;
  result?: unknown;
  diagnostics?: Diagnostic[];
  error?: { code?: string; message?: string; details?: unknown };
  traceId?: string;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(nodeFileSystem.readText(absolute) ?? "");
  return JSON.parse(raw) as T;
}

export function loadExternalServiceGraph(
  workspaceRoot: string,
): { graph: ForgeExternalServiceGraph | null; diagnostics: Diagnostic[] } {
  const graph = readGeneratedJson<ForgeExternalServiceGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/externalServices.json`,
  );
  if (!graph) {
    return {
      graph: null,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/externalServices.json; run forge generate first`,
          file: `${GENERATED_DIR}/externalServices.json`,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
    };
  }
  return { graph, diagnostics: graph.diagnostics ?? [] };
}

function findExternalEntry(
  graph: ForgeExternalServiceGraph,
  serviceName: string,
  entryName: string,
  kind: "command" | "query",
): { service: ForgeExternalService; entry: ForgeExternalServiceEntry } | null {
  const service = graph.services.find((candidate) => candidate.name === serviceName);
  const entry = service?.entries.find(
    (candidate) => candidate.name === entryName && candidate.kind === kind,
  );
  return service && entry ? { service, entry } : null;
}

export function parseExternalQualifiedName(name: string): {
  serviceName: string;
  entryName: string;
} | null {
  const [serviceName, ...entryParts] = name.split(".");
  const entryName = entryParts.join(".");
  return serviceName && entryName ? { serviceName, entryName } : null;
}

export function resolveExternalQualifiedName(
  workspaceRoot: string,
  qualifiedName: string,
  kind: "command" | "query",
): { service: ForgeExternalService; entry: ForgeExternalServiceEntry; serviceName: string; entryName: string } | null {
  const parsed = parseExternalQualifiedName(qualifiedName);
  if (!parsed) {
    return null;
  }
  const loaded = loadExternalServiceGraph(workspaceRoot);
  if (!loaded.graph) {
    return null;
  }
  const found = findExternalEntry(loaded.graph, parsed.serviceName, parsed.entryName, kind);
  return found ? { ...found, ...parsed } : null;
}

function runtimeEntryFor(entry: ForgeExternalServiceEntry): RuntimeEntry {
  return {
    id: `external:${entry.service}:${entry.kind}:${entry.name}`,
    kind: "command",
    name: `${entry.service}.${entry.name}`,
    qualifiedName: `${entry.service}.${entry.name}`,
    file: `external:${entry.service}`,
    moduleId: `external:${entry.service}`,
    runtimeContext: "command",
    dependencies: [],
  };
}

function queryDefinitionFor(entry: ForgeExternalServiceEntry): QueryDefinition {
  return {
    name: `${entry.service}.${entry.name}`,
    qualifiedName: `${entry.service}.${entry.name}`,
    file: `external:${entry.service}`,
    symbolId: `external:${entry.service}:query:${entry.name}`,
    moduleId: `external:${entry.service}`,
  };
}

function authHeaders(auth: AuthContext | undefined, traceId: string): Record<string, string> {
  const headers: Record<string, string> = {
    "x-forge-trace-id": traceId,
    "x-forge-auth-kind": auth?.kind ?? "anonymous",
  };
  if (auth?.kind === "user") {
    headers["x-forge-user-id"] = auth.userId;
    if (auth.tenantId) headers["x-forge-tenant-id"] = auth.tenantId;
    if (auth.role) headers["x-forge-role"] = auth.role;
    if (auth.roles) headers["x-forge-roles"] = JSON.stringify(auth.roles);
    if (auth.permissions) headers["x-forge-permissions"] = JSON.stringify(auth.permissions);
  }
  if (auth?.kind === "system" && auth.tenantId) {
    headers["x-forge-tenant-id"] = auth.tenantId;
  }
  return headers;
}

function inboundAuthHeader(headers: Headers | undefined): string | null {
  return headers?.get("authorization") ?? headers?.get("Authorization") ?? null;
}

function normalizeExternalPayload(
  body: unknown,
  responseOk: boolean,
  status: number,
  fallbackTraceId: string,
): ExternalRuntimeResult {
  const envelope = body && typeof body === "object" ? (body as ExternalEnvelope) : {};
  const diagnostics = Array.isArray(envelope.diagnostics) ? envelope.diagnostics : [];
  const traceId = envelope.traceId ?? fallbackTraceId;

  if (envelope.ok === false || !responseOk) {
    const message =
      envelope.error?.message ??
      diagnostics.find((diagnostic) => diagnostic.message)?.message ??
      `external runtime returned HTTP ${status}`;
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: envelope.error?.code ?? FORGE_EXTERNAL_RUNTIME_FAILED,
          message,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
      traceId,
      exitCode: 1,
    };
  }

  return {
    ok: true,
    result: "result" in envelope ? envelope.result : body,
    diagnostics,
    traceId,
    exitCode: 0,
  };
}

function externalRequestBody(call: ExternalRuntimeCall, traceId: string): unknown {
  return {
    args: call.args ?? {},
    auth: snapshotAuth(call.auth ?? { kind: "anonymous" }),
    forge: {
      service: call.serviceName,
      entry: call.entryName,
      kind: call.kind,
      traceId,
    },
  };
}

function withArgsSearchParams(url: URL, args: unknown): URL {
  url.searchParams.set("args", JSON.stringify(args ?? {}));
  return url;
}

async function runHttpExternalEntry(
  service: ForgeExternalService,
  entry: ForgeExternalServiceEntry,
  call: ExternalRuntimeCall,
  traceId: string,
): Promise<ExternalRuntimeResult> {
  if (!service.baseUrl) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_UNSUPPORTED,
          message: `external service '${service.name}' uses http transport but has no baseUrl`,
          file: `external:${service.name}`,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }

  const method = entry.method ?? "POST";
  const url = new URL(entry.path ?? `/${entry.kind}s/${entry.name}`, service.baseUrl);
  if (method === "GET") {
    withArgsSearchParams(url, call.args);
  }

  const authorization = inboundAuthHeader(call.requestHeaders);
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-forge-external-service": service.name,
      "x-forge-external-entry": entry.name,
      "x-forge-external-kind": entry.kind,
      ...authHeaders(call.auth, traceId),
      ...(authorization ? { authorization } : {}),
    },
    body: method === "GET" ? undefined : JSON.stringify(externalRequestBody(call, traceId)),
  });

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_BAD_RESPONSE,
          message: `external ${entry.kind} '${service.name}.${entry.name}' returned non-JSON response`,
          file: `external:${service.name}`,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }

  return {
    ...normalizeExternalPayload(body, response.ok, response.status, traceId),
    service,
    entry,
  };
}

export function parseExternalCommandLine(command: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  let escaping = false;

  const push = () => {
    if (current.length > 0) {
      parts.push(current);
      current = "";
    }
  };

  for (const char of command) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (quote === "\"") {
      if (char === "\"") {
        quote = null;
      } else if (char === "\\") {
        escaping = true;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\\") {
      escaping = true;
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    current += char;
  }
  if (escaping) {
    current += "\\";
  }
  push();
  return parts;
}

async function runStdioExternalEntry(
  service: ForgeExternalService,
  entry: ForgeExternalServiceEntry,
  call: ExternalRuntimeCall,
  traceId: string,
): Promise<ExternalRuntimeResult> {
  if (!service.command) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_UNSUPPORTED,
          message: `external service '${service.name}' uses stdio transport but has no command`,
          file: `external:${service.name}`,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }

  const [executable, ...args] = parseExternalCommandLine(service.command);
  if (!executable) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_UNSUPPORTED,
          message: `external service '${service.name}' has an empty stdio command`,
          file: `external:${service.name}`,
        }),
      ],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      resolve({
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: FORGE_EXTERNAL_RUNTIME_FAILED,
            message: `external stdio command failed to start: ${error.message}`,
            file: `external:${service.name}`,
          }),
        ],
        traceId,
        exitCode: 1,
        service,
        entry,
      });
    });
    child.on("close", (code) => {
      try {
        const parsed = stdout.trim().length > 0 ? JSON.parse(stdout) : {};
        resolve({
          ...normalizeExternalPayload(parsed, code === 0, code ?? 1, traceId),
          service,
          entry,
        });
      } catch {
        resolve({
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_EXTERNAL_RUNTIME_BAD_RESPONSE,
              message: `external stdio command returned invalid JSON${stderr ? `: ${stderr}` : ""}`,
              file: `external:${service.name}`,
            }),
          ],
          traceId,
          exitCode: 1,
          service,
          entry,
        });
      }
    });
    child.stdin.end(JSON.stringify(externalRequestBody(call, traceId)));
  });
}

export async function runExternalEntry(
  workspaceRoot: string,
  call: ExternalRuntimeCall,
  runtime?: { adapter?: DbAdapter | null },
): Promise<ExternalRuntimeResult> {
  const traceId = generateTraceId();
  const loaded = loadExternalServiceGraph(workspaceRoot);
  if (!loaded.graph) {
    return {
      ok: false,
      diagnostics: loaded.diagnostics,
      traceId,
      exitCode: 1,
    };
  }

  const found = findExternalEntry(
    loaded.graph,
    call.serviceName,
    call.entryName,
    call.kind,
  );
  if (!found) {
    return {
      ok: false,
      diagnostics: [
        ...loaded.diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_NOT_FOUND,
          message: `external ${call.kind} '${call.serviceName}.${call.entryName}' not found`,
          file: `${GENERATED_DIR}/externalServices.json`,
        }),
      ],
      traceId,
      exitCode: 1,
    };
  }

  const { service, entry } = found;
  const telemetry = runtime?.adapter
    ? createTelemetryContext({
        adapter: runtime.adapter,
        traceId,
        requestId: call.requestId ?? generateRequestId(),
        runtime: { kind: call.kind, name: `${service.name}.${entry.name}` },
        bufferInTransaction: false,
        workspaceRoot,
      })
    : undefined;

  const policyCheck = call.kind === "command"
    ? await checkCommandPolicy({
        workspaceRoot,
        entry: runtimeEntryFor(entry),
        auth: call.auth ?? { kind: "anonymous" },
        telemetry,
      })
    : await checkQueryPolicy({
        workspaceRoot,
        query: queryDefinitionFor(entry),
        auth: call.auth ?? { kind: "anonymous" },
        telemetry,
      });
  if (!policyCheck.allowed) {
    return {
      ok: false,
      diagnostics: [...loaded.diagnostics, ...policyCheck.diagnostics],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }

  await telemetry?.capture("forge.external.started", {
    service: service.name,
    entry: entry.name,
    kind: entry.kind,
    transport: service.transport,
  });

  try {
    const result = service.transport === "http"
      ? await runHttpExternalEntry(service, entry, call, traceId)
      : service.transport === "stdio"
        ? await runStdioExternalEntry(service, entry, call, traceId)
        : {
            ok: false,
            diagnostics: [
              createDiagnostic({
                severity: "error",
                code: FORGE_EXTERNAL_RUNTIME_UNSUPPORTED,
                message: `external transport '${service.transport}' is not executable by this Forge runtime`,
                file: `external:${service.name}`,
                docs: ["docs/forge-protocol.md"],
              }),
            ],
            traceId,
            exitCode: 1 as const,
            service,
            entry,
          };

    await telemetry?.capture(result.ok ? "forge.external.completed" : "forge.external.failed", {
      service: service.name,
      entry: entry.name,
      kind: entry.kind,
      transport: service.transport,
    });

    return {
      ...result,
      diagnostics: [...loaded.diagnostics, ...result.diagnostics],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "external runtime failed";
    await telemetry?.capture("forge.external.failed", {
      service: service.name,
      entry: entry.name,
      kind: entry.kind,
      error: message,
    });
    return {
      ok: false,
      diagnostics: [
        ...loaded.diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_EXTERNAL_RUNTIME_FAILED,
          message,
          file: `external:${service.name}`,
          docs: ["docs/forge-protocol.md"],
        }),
      ],
      traceId,
      exitCode: 1,
      service,
      entry,
    };
  }
}
