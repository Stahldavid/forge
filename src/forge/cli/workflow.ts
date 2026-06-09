import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import {
  FORGE_RUNTIME_NOT_FOUND,
  FORGE_WORKFLOW_RUN_NOT_FOUND,
  FORGE_WORKFLOW_UNKNOWN,
} from "../compiler/diagnostics/codes.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { canonicalJson } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import { createDbAdapter, type CreateDbAdapterOptions } from "../runtime/db/factory.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import { prepareRuntimeEnvironment } from "../runtime/executor.ts";
import { cancelWorkflowRun } from "../runtime/workflows/cancel.ts";
import { createWorkflowRun } from "../runtime/workflows/create-run.ts";
import {
  getWorkflowSummary,
  inspectWorkflowRun,
  listWorkflowRuns,
  processWorkflowBatch,
  runWorkerTick,
} from "../runtime/workflows/process.ts";
import { loadWorkflowRegistry } from "../runtime/workflows/registry.ts";
import { retryWorkflowRun } from "../runtime/workflows/retry-run.ts";

export type WorkflowSubcommand =
  | "list"
  | "run"
  | "inspect"
  | "process"
  | "retry"
  | "cancel";

export interface WorkflowCommandOptions {
  subcommand: WorkflowSubcommand;
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
  once?: boolean;
  watch?: boolean;
  limit?: number;
  workflowName?: string;
  runId?: number;
  stepName?: string;
  input?: unknown;
  mock?: boolean;
}

export interface WorkflowCommandResult {
  ok: boolean;
  data?: unknown;
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

function adapterOptions(options: WorkflowCommandOptions): CreateDbAdapterOptions {
  return {
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  };
}

async function loadRuntimeArtifacts(workspaceRoot: string): Promise<{
  runtimeGraph: RuntimeGraph | null;
  tableMap: Record<string, TableMapEntry>;
  sqlPlan: SqlPlan | null;
}> {
  const runtimeGraph = readGeneratedJson<RuntimeGraph>(
    workspaceRoot,
    `${GENERATED_DIR}/runtimeGraph.json`,
  );
  const dbJson = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
    workspaceRoot,
    `${GENERATED_DIR}/db.json`,
  );
  const sqlPlan = readGeneratedJson<SqlPlan>(
    workspaceRoot,
    `${GENERATED_DIR}/sqlPlan.json`,
  );

  return {
    runtimeGraph,
    tableMap: dbJson?.tableMap ?? {},
    sqlPlan,
  };
}

export async function runWorkflowCommand(
  options: WorkflowCommandOptions,
): Promise<WorkflowCommandResult> {
  const { runtimeGraph, tableMap, sqlPlan } = await loadRuntimeArtifacts(
    options.workspaceRoot,
  );

  if (!runtimeGraph) {
    return {
      ok: false,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: FORGE_RUNTIME_NOT_FOUND,
          message: `missing ${GENERATED_DIR}/runtimeGraph.json; run forge generate first`,
        }),
      ],
      exitCode: 1,
    };
  }

  const { adapter, diagnostics: adapterDiagnostics } = await createDbAdapter(
    adapterOptions(options),
  );

  if (!adapter) {
    return {
      ok: false,
      diagnostics: adapterDiagnostics,
      exitCode: 1,
    };
  }

  try {
    if (sqlPlan) {
      await applyMigrations(adapter, sqlPlan);
    }

    await prepareRuntimeEnvironment(options.workspaceRoot, {
      mock: options.mock ?? false,
      db: adapter,
    });

    if (options.subcommand === "list") {
      const { workflows } = loadWorkflowRegistry(options.workspaceRoot);
      const runs = await listWorkflowRuns(adapter);
      const summary = await getWorkflowSummary(adapter);
      return {
        ok: true,
        data: { workflows, runs, summary },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "run") {
      if (!options.workflowName) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_UNKNOWN,
              message: "forge workflow run requires a workflow name",
            }),
          ],
          exitCode: 1,
        };
      }

      const { workflows } = loadWorkflowRegistry(options.workspaceRoot);
      const input = options.input ?? {};
      const idempotencyKey = `${options.workflowName}:manual:${hashStable(canonicalJson(input))}`;

      const result = await createWorkflowRun(adapter, workflows, {
        workflowName: options.workflowName,
        input,
        triggerType: "manual",
        idempotencyKey,
      });

      return {
        ok: true,
        data: result,
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "inspect") {
      if (options.runId === undefined) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: "forge workflow inspect requires a run id",
            }),
          ],
          exitCode: 1,
        };
      }

      const inspected = await inspectWorkflowRun(adapter, options.runId);
      if (!inspected.run) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: `workflow run '${options.runId}' not found`,
            }),
          ],
          exitCode: 1,
        };
      }

      return {
        ok: true,
        data: inspected,
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "retry") {
      if (options.runId === undefined) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: "forge workflow retry requires a run id",
            }),
          ],
          exitCode: 1,
        };
      }

      const retried = await retryWorkflowRun(adapter, options.runId, options.stepName);
      if (!retried) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: `workflow run '${options.runId}' not found`,
            }),
          ],
          exitCode: 1,
        };
      }

      return {
        ok: true,
        data: { runId: options.runId, status: "pending" },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "cancel") {
      if (options.runId === undefined) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: "forge workflow cancel requires a run id",
            }),
          ],
          exitCode: 1,
        };
      }

      const canceled = await cancelWorkflowRun(adapter, options.runId);
      if (!canceled) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_WORKFLOW_RUN_NOT_FOUND,
              message: `workflow run '${options.runId}' not found or not cancelable`,
            }),
          ],
          exitCode: 1,
        };
      }

      return {
        ok: true,
        data: { runId: options.runId, status: "canceled" },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "process") {
      const runBatch = async () => {
        if (options.once || options.watch) {
          return runWorkerTick(
            adapter,
            options.workspaceRoot,
            tableMap,
            runtimeGraph.entries,
            {
              limit: options.limit ?? 10,
              mock: options.mock ?? false,
            },
          );
        }
        const workflowBatch = await processWorkflowBatch(
          adapter,
          options.workspaceRoot,
          tableMap,
          {
            limit: options.limit ?? 10,
            mock: options.mock ?? false,
          },
        );
        return { workflows: { started: 0, skipped: 0 }, outbox: null, workflowBatch };
      };

      if (options.watch) {
        let running = true;
        const intervalMs = 2_000;

        const shutdown = () => {
          running = false;
        };
        process.once("SIGINT", shutdown);
        process.once("SIGTERM", shutdown);

        while (running) {
          const batch = await runBatch();
          if (!options.json) {
            const wf = batch.workflowBatch;
            process.stdout.write(
              `workflows completed=${wf.completed} failed=${wf.failed} dead=${wf.dead} claimed=${wf.claimed}\n`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }

        return { ok: true, data: { watch: true }, diagnostics: [], exitCode: 0 };
      }

      const batch = await runBatch();
      return {
        ok: true,
        data: batch,
        diagnostics: [],
        exitCode: 0,
      };
    }

    return {
      ok: false,
      diagnostics: [],
      exitCode: 1,
    };
  } finally {
    await adapter.close();
  }
}

export function formatWorkflowJson(result: WorkflowCommandResult): string {
  return `${JSON.stringify({
    ok: result.ok,
    data: result.data,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  })}\n`;
}

export function formatWorkflowHuman(
  subcommand: WorkflowSubcommand,
  result: WorkflowCommandResult,
): string {
  if (!result.ok) {
    return result.diagnostics
      .map((diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n")
      .concat("\n");
  }

  if (subcommand === "run") {
    const data = result.data as { created: boolean; run: { id: number } };
    return `run ${data.run.id} ${data.created ? "created" : "existing"}\n`;
  }

  if (subcommand === "retry" || subcommand === "cancel") {
    return `${subcommand} run ${(result.data as { runId: number }).runId}\n`;
  }

  if (subcommand === "process") {
    const batch = result.data as {
      workflowBatch?: {
        claimed: number;
        completed: number;
        failed: number;
        dead: number;
      };
    };
    const wf = batch.workflowBatch;
    if (!wf) {
      return "processed workflow batch\n";
    }
    return `claimed=${wf.claimed} completed=${wf.completed} failed=${wf.failed} dead=${wf.dead}\n`;
  }

  return `${JSON.stringify(result.data, null, 2)}\n`;
}
