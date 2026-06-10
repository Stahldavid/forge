import { join } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_LIVEQUERY_AI_FORBIDDEN,
  FORGE_LIVEQUERY_EMIT_FORBIDDEN,
  FORGE_LIVEQUERY_POLICY_DENIED,
  FORGE_LIVEQUERY_RERUN_FAILED,
  FORGE_LIVEQUERY_SECRET_FORBIDDEN,
  FORGE_LIVEQUERY_SUBSCRIPTION_FAILED,
  FORGE_LIVEQUERY_UNKNOWN,
  FORGE_LIVEQUERY_WRITE_FORBIDDEN,
  FORGE_POLICY_DENIED,
  FORGE_QUERY_AI_FORBIDDEN,
  FORGE_QUERY_EMIT_FORBIDDEN,
  FORGE_QUERY_SECRET_FORBIDDEN,
  FORGE_QUERY_WRITE_FORBIDDEN,
  FORGE_TENANT_SCOPE_VIOLATION,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { LiveQueryDefinition } from "../../compiler/types/live-query-registry.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { adapterAsTransaction } from "../db/adapter.ts";
import { createReadOnlyDbClient } from "../db/read-only-client.ts";
import { TenantScopeViolationError } from "../db/generated-client.ts";
import type { AuthContext } from "../auth/types.ts";
import { checkQueryPolicy } from "../policy/check.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import type { TelemetryContext } from "../telemetry/types.ts";
import { DependencyTracker } from "./dependency-tracker.ts";
import { loadLiveQueryRegistry } from "./registry.ts";
import type { DataDependency } from "./types.ts";

export interface RunLiveQueryOptions {
  args?: unknown;
  auth: AuthContext;
  subscriptionId?: string;
  revision?: number;
  rerun?: boolean;
}

export interface RunLiveQueryRuntime {
  adapter: DbAdapter;
  tableMap: Record<string, TableMapEntry>;
}

export interface RunLiveQueryResult {
  ok: boolean;
  result?: unknown;
  liveQuery?: LiveQueryDefinition;
  dependencies: DataDependency[];
  diagnostics: Diagnostic[];
  traceId?: string;
}

interface LiveQueryContext {
  db: ReturnType<typeof createReadOnlyDbClient>;
  telemetry: TelemetryContext;
  auth: AuthContext;
  emit: never;
  secrets: never;
  ai: never;
}

function liveContextForbidden(property: "emit" | "secrets" | "ai"): never {
  const code =
    property === "emit"
      ? FORGE_LIVEQUERY_EMIT_FORBIDDEN
      : property === "secrets"
        ? FORGE_LIVEQUERY_SECRET_FORBIDDEN
        : FORGE_LIVEQUERY_AI_FORBIDDEN;
  throw new Error(`${code}: ${property} is forbidden in liveQuery context`);
}

function createLiveQueryContext(
  db: ReturnType<typeof createReadOnlyDbClient>,
  telemetry: TelemetryContext,
  auth: AuthContext,
): LiveQueryContext {
  return {
    db,
    telemetry,
    auth,
    get emit(): never {
      return liveContextForbidden("emit");
    },
    get secrets(): never {
      return liveContextForbidden("secrets");
    },
    get ai(): never {
      return liveContextForbidden("ai");
    },
  };
}

function liveDiagnosticCodeForMessage(message: string): string {
  if (message.includes(FORGE_LIVEQUERY_WRITE_FORBIDDEN) || message.includes(FORGE_QUERY_WRITE_FORBIDDEN)) {
    return FORGE_LIVEQUERY_WRITE_FORBIDDEN;
  }
  if (message.includes(FORGE_LIVEQUERY_EMIT_FORBIDDEN) || message.includes(FORGE_QUERY_EMIT_FORBIDDEN)) {
    return FORGE_LIVEQUERY_EMIT_FORBIDDEN;
  }
  if (message.includes(FORGE_LIVEQUERY_SECRET_FORBIDDEN) || message.includes(FORGE_QUERY_SECRET_FORBIDDEN)) {
    return FORGE_LIVEQUERY_SECRET_FORBIDDEN;
  }
  if (message.includes(FORGE_LIVEQUERY_AI_FORBIDDEN) || message.includes(FORGE_QUERY_AI_FORBIDDEN)) {
    return FORGE_LIVEQUERY_AI_FORBIDDEN;
  }
  return FORGE_LIVEQUERY_RERUN_FAILED;
}

export async function runLiveQuery(
  workspaceRoot: string,
  name: string,
  options: RunLiveQueryOptions,
  runtime: RunLiveQueryRuntime,
): Promise<RunLiveQueryResult> {
  const { registry, liveQueries } = loadLiveQueryRegistry(workspaceRoot);
  const diagnostics: Diagnostic[] = registry?.diagnostics ? [...registry.diagnostics] : [];
  const traceId = generateTraceId();

  const liveQuery = liveQueries.find((candidate) => candidate.name === name);
  if (!registry || !liveQuery) {
    return {
      ok: false,
      dependencies: [],
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_LIVEQUERY_UNKNOWN,
          message: !registry
            ? "missing src/forge/_generated/liveQueryRegistry.json; run forge generate first"
            : `liveQuery '${name}' not found`,
        }),
      ],
      traceId,
    };
  }

  const telemetry = createTelemetryContext({
    adapter: runtime.adapter,
    traceId,
    runtime: { kind: "query", name: liveQuery.name },
    bufferInTransaction: false,
    workspaceRoot,
  });

  const policyCheck = await checkQueryPolicy({
    workspaceRoot,
    query: {
      name: liveQuery.name,
      qualifiedName: liveQuery.qualifiedName,
      file: liveQuery.file,
      symbolId: liveQuery.symbolId,
      moduleId: liveQuery.moduleId,
    },
    auth: options.auth,
    telemetry,
  });

  if (!policyCheck.allowed) {
    return {
      ok: false,
      liveQuery,
      dependencies: [],
      diagnostics: [
        ...diagnostics,
        ...policyCheck.diagnostics.map((diagnostic) =>
          diagnostic.code === FORGE_POLICY_DENIED
            ? { ...diagnostic, code: FORGE_LIVEQUERY_POLICY_DENIED }
            : diagnostic,
        ),
      ],
      traceId,
    };
  }

  const startedAt = performance.now();
  await telemetry.capture("forge.liveQuery.subscribed", {
    name: liveQuery.name,
    tenantId: options.auth.kind === "user" ? options.auth.tenantId : null,
  });

  try {
    const absolutePath = join(workspaceRoot, liveQuery.file);
    const mod = (await import(absolutePath)) as Record<string, unknown>;
    const exported = mod[liveQuery.exportName];

    if (
      !exported ||
      typeof exported !== "object" ||
      !("handler" in exported) ||
      typeof (exported as { handler: unknown }).handler !== "function"
    ) {
      throw new Error(`export '${liveQuery.exportName}' is not a liveQuery handler`);
    }

    const dependencyTracker = new DependencyTracker();
    const db = createReadOnlyDbClient(
      adapterAsTransaction(runtime.adapter),
      runtime.tableMap,
      {
        auth: options.auth,
        liveQuery: true,
        onRead: (table, tenantId) => dependencyTracker.record(table, tenantId),
      },
    );
    const ctx = createLiveQueryContext(db, telemetry, options.auth);
    const handler = (exported as {
      handler: (ctx: unknown, args: unknown) => unknown | Promise<unknown>;
    }).handler;

    const result = await handler(ctx, options.args ?? {});
    const rowCount = Array.isArray(result) ? result.length : undefined;
    const durationMs = Math.round(performance.now() - startedAt);

    await telemetry.capture(options.rerun ? "forge.liveQuery.rerun" : "forge.liveQuery.snapshot", {
      name: liveQuery.name,
      tenantId: options.auth.kind === "user" ? options.auth.tenantId : null,
      revision: options.revision ?? 1,
      durationMs,
      rowCount,
      traceId,
    });

    return {
      ok: true,
      result,
      liveQuery,
      dependencies: dependencyTracker.snapshot(),
      diagnostics: [...diagnostics, ...policyCheck.diagnostics],
      traceId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "liveQuery execution failed";
    const code =
      error instanceof TenantScopeViolationError
        ? FORGE_TENANT_SCOPE_VIOLATION
        : liveDiagnosticCodeForMessage(message);

    await telemetry.capture("forge.liveQuery.error", {
      name: liveQuery.name,
      error: message,
      traceId,
    });

    return {
      ok: false,
      liveQuery,
      dependencies: [],
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: options.rerun ? code : code === FORGE_LIVEQUERY_RERUN_FAILED
            ? FORGE_LIVEQUERY_SUBSCRIPTION_FAILED
            : code,
          message,
          file: liveQuery.file,
        }),
      ],
      traceId,
    };
  }
}
