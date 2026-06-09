import { join } from "node:path";
import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import {
  FORGE_POLICY_DENIED,
  FORGE_QUERY_FAILED,
  FORGE_QUERY_INTEGRATION_FORBIDDEN,
  FORGE_QUERY_NOT_FOUND,
  FORGE_RUNTIME_GUARD_BLOCKED,
  FORGE_TENANT_SCOPE_VIOLATION,
} from "../../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../../compiler/data-graph/sql/serialize.ts";
import type { Diagnostic } from "../../compiler/types/diagnostic.ts";
import type { QueryDefinition } from "../../compiler/types/query-registry.ts";
import type { DbAdapter } from "../db/adapter.ts";
import { adapterAsTransaction } from "../db/adapter.ts";
import { createReadOnlyDbClient } from "../db/read-only-client.ts";
import { TenantScopeViolationError } from "../db/generated-client.ts";
import { createQueryContext } from "../context/create-query-context.ts";
import { createTelemetryContext } from "../telemetry/context.ts";
import { generateTraceId } from "../telemetry/correlation.ts";
import type { AuthContext } from "../auth/types.ts";
import { resolveAuthFromCli } from "../auth/resolve.ts";
import { checkQueryPolicy } from "../policy/check.ts";
import { loadQueryRegistry } from "./registry.ts";
import { checkImportGuards } from "../../compiler/guards/check-import-guards.ts";
import { buildAppGraph } from "../../compiler/app-graph/build.ts";
import { discover } from "../../compiler/orchestrator/discover.ts";
import { loadManifest } from "../../compiler/orchestrator/manifest.ts";
import type { RuntimeMatrix } from "../../compiler/types/runtime-matrix.ts";
import { GENERATED_DIR } from "../../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../compiler/primitives/header.ts";
import { readFileSync, existsSync } from "node:fs";

export interface RunQueryOptions {
  args?: unknown;
  auth?: AuthContext;
  userId?: string;
  tenantId?: string;
  role?: string;
  requestId?: string;
}

export interface RunQueryResult {
  ok: boolean;
  result?: unknown;
  query?: QueryDefinition;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
  traceId?: string;
}

export interface ListQueriesResult {
  queries: QueryDefinition[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader(readFileSync(absolute, "utf8"));
  return JSON.parse(raw) as T;
}

async function loadRuntimeMatrix(workspaceRoot: string): Promise<RuntimeMatrix> {
  const fromDisk = readGeneratedJson<RuntimeMatrix>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeMatrix.json`,
  );
  if (fromDisk) {
    return fromDisk;
  }
  throw new Error("missing runtimeMatrix.json");
}

async function guardPreflight(
  workspaceRoot: string,
  query: QueryDefinition,
): Promise<Diagnostic[]> {
  const ctx = discover({ workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);
  const appGraph = await buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });

  const matrix = await loadRuntimeMatrix(workspaceRoot);
  const violations = checkImportGuards(appGraph.moduleGraph, matrix);

  return violations.filter((diagnostic) => diagnostic.file === query.file);
}

export function listQueries(workspaceRoot: string): ListQueriesResult {
  const { registry, queries } = loadQueryRegistry(workspaceRoot);

  if (!registry) {
    return {
      queries: [],
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_QUERY_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/queryRegistry.json; run forge generate first`,
          file: `${GENERATED_DIR}/queryRegistry.json`,
        }),
      ],
      exitCode: 1,
    };
  }

  return {
    queries,
    diagnostics: [...(registry.diagnostics ?? [])],
    exitCode: 0,
  };
}

export async function runQuery(
  workspaceRoot: string,
  name: string,
  options: RunQueryOptions,
  runtime?: {
    adapter?: DbAdapter | null;
    tableMap?: Record<string, TableMapEntry>;
    auth?: AuthContext;
  },
): Promise<RunQueryResult> {
  const { registry, queries } = loadQueryRegistry(workspaceRoot);
  const diagnostics: Diagnostic[] = registry?.diagnostics ? [...registry.diagnostics] : [];

  if (!registry) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_QUERY_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/queryRegistry.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }

  const query = queries.find((candidate) => candidate.name === name);
  if (!query) {
    return {
      ok: false,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_QUERY_NOT_FOUND,
          message: `query '${name}' not found`,
        }),
      ],
      exitCode: 1,
    };
  }

  const guardViolations = await guardPreflight(workspaceRoot, query);
  if (guardViolations.length > 0) {
    return {
      ok: false,
      query,
      diagnostics: [
        ...diagnostics,
        ...guardViolations,
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_GUARD_BLOCKED,
          message: `query '${name}' blocked by import guard violations`,
          file: query.file,
        }),
      ],
      exitCode: 1,
    };
  }

  const auth =
    options.auth ??
    runtime?.auth ??
    resolveAuthFromCli({
      userId: options.userId,
      tenantId: options.tenantId,
      role: options.role,
    });

  const traceId = generateTraceId();
  const adapter = runtime?.adapter;
  const tableMap = runtime?.tableMap;

  if (!adapter || !tableMap) {
    return {
      ok: false,
      query,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: FORGE_QUERY_FAILED,
          message: `query '${name}' requires a database connection`,
          file: query.file,
        }),
      ],
      exitCode: 1,
      traceId,
    };
  }

  const preflightTelemetry = createTelemetryContext({
    adapter,
    traceId,
    requestId: options.requestId,
    runtime: { kind: "query", name: query.name },
    bufferInTransaction: false,
    workspaceRoot,
  });

  const policyCheck = await checkQueryPolicy({
    workspaceRoot,
    query,
    auth,
    telemetry: preflightTelemetry,
  });

  if (!policyCheck.allowed) {
    return {
      ok: false,
      query,
      diagnostics: [...diagnostics, ...policyCheck.diagnostics],
      exitCode: 1,
      traceId,
    };
  }

  await preflightTelemetry.capture("forge.query.started", {
    query: query.name,
  });

  try {
    const absolutePath = join(workspaceRoot, query.file);
    const mod = (await import(absolutePath)) as Record<string, unknown>;
    const exported = mod[query.name];

    if (
      !exported ||
      typeof exported !== "object" ||
      !("handler" in exported) ||
      typeof (exported as { handler: unknown }).handler !== "function"
    ) {
      throw new Error(`export '${query.name}' is not a query handler`);
    }

    const handler = (exported as {
      handler: (ctx: unknown, args: unknown) => unknown | Promise<unknown>;
    }).handler;

    const db = createReadOnlyDbClient(adapterAsTransaction(adapter), tableMap, { auth });
    const ctx = createQueryContext(db, preflightTelemetry, auth);
    const result = await handler(ctx, options.args ?? {});

    await preflightTelemetry.capture("forge.query.completed", {
      query: query.name,
    });

    return {
      ok: true,
      result,
      query,
      diagnostics: [...diagnostics, ...policyCheck.diagnostics],
      exitCode: 0,
      traceId,
    };
  } catch (error) {
    if (error instanceof TenantScopeViolationError) {
      await preflightTelemetry.capture("forge.tenant_scope.denied", {
        table: error.table,
        operation: error.operation,
      });

      return {
        ok: false,
        query,
        diagnostics: [
          ...diagnostics,
          createDiagnostic({
            severity: "error",
            code: FORGE_TENANT_SCOPE_VIOLATION,
            message: error.message,
            file: query.file,
          }),
        ],
        exitCode: 1,
        traceId,
      };
    }

    const message = error instanceof Error ? error.message : "query execution failed";
    const integrationForbidden = message.includes(FORGE_QUERY_INTEGRATION_FORBIDDEN);

    await preflightTelemetry.capture("forge.query.failed", {
      query: query.name,
      error: message,
    });

    return {
      ok: false,
      query,
      diagnostics: [
        ...diagnostics,
        createDiagnostic({
          severity: "error",
          code: integrationForbidden
            ? FORGE_QUERY_INTEGRATION_FORBIDDEN
            : message.includes("FORGE_QUERY_")
              ? (message.split(":")[0] as Diagnostic["code"])
              : FORGE_QUERY_FAILED,
          message,
          file: query.file,
        }),
      ],
      exitCode: 1,
      traceId,
    };
  }
}

export function isQueryPolicyDenied(result: RunQueryResult): boolean {
  return result.diagnostics.some((diagnostic) => diagnostic.code === FORGE_POLICY_DENIED);
}
