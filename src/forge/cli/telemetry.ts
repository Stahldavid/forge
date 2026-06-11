import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { FORGE_RUNTIME_NOT_FOUND } from "../compiler/diagnostics/codes.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { SqlPlan } from "../compiler/data-graph/sql/types.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { createDbAdapter, type CreateDbAdapterOptions } from "../runtime/db/factory.ts";
import type { DbAdapterKind } from "../runtime/db/adapter.ts";
import { applyMigrations } from "../runtime/db/migrate.ts";
import {
  clearTelemetryEvents,
  flushPendingTelemetry,
  getTelemetrySummary,
  inspectTrace,
  listTelemetryEvents,
} from "../runtime/telemetry/flush.ts";
import { localJsonlPaths } from "../runtime/telemetry/sinks/local-jsonl.ts";

export type TelemetrySubcommand = "list" | "inspect" | "symbolicate" | "flush" | "tail" | "clear";

export interface TelemetryCommandOptions {
  subcommand: TelemetrySubcommand;
  workspaceRoot: string;
  db: DbAdapterKind;
  databaseUrl?: string;
  json: boolean;
  traceId?: string;
  sink?: string;
  file?: "events" | "exceptions" | "spans";
}

export interface TelemetryCommandResult {
  ok: boolean;
  data?: unknown;
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

function readGeneratedJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  const raw = stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""));
  return JSON.parse(raw) as T;
}

function adapterOptions(options: TelemetryCommandOptions): CreateDbAdapterOptions {
  return {
    kind: options.db,
    workspaceRoot: options.workspaceRoot,
    databaseUrl: options.databaseUrl,
  };
}

function tailJsonl(path: string, lines = 20): string[] {
  if (!nodeFileSystem.exists(path)) {
    return [];
  }
  const content = (nodeFileSystem.readText(path) ?? "");
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .slice(-lines);
}

export async function runTelemetryCommand(
  options: TelemetryCommandOptions,
): Promise<TelemetryCommandResult> {
  if (options.subcommand === "tail") {
    const paths = localJsonlPaths(options.workspaceRoot);
    const file = options.file ?? "events";
    const target = paths[file];
    const lines = tailJsonl(target);
    return {
      ok: true,
      data: { file, path: target, lines },
      diagnostics: [],
      exitCode: 0,
    };
  }

  const sqlPlan = readGeneratedJson<SqlPlan>(
    options.workspaceRoot,
    `${GENERATED_DIR}/sqlPlan.json`,
  );

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

    if (options.subcommand === "list") {
      const events = await listTelemetryEvents(adapter);
      const summary = await getTelemetrySummary(adapter);
      return {
        ok: true,
        data: { summary, events },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "inspect" || options.subcommand === "symbolicate") {
      if (!options.traceId) {
        return {
          ok: false,
          diagnostics: [
            createDiagnostic({
              severity: "error",
              code: FORGE_RUNTIME_NOT_FOUND,
              message: `forge telemetry ${options.subcommand} requires a trace id`,
            }),
          ],
          exitCode: 1,
        };
      }

      const inspected = await inspectTrace(adapter, options.traceId);
      if (options.subcommand === "symbolicate") {
        const releases = inspected.events
          .map((event) => (event.payload as { release?: unknown } | undefined)?.release)
          .filter(Boolean);
        return {
          ok: true,
          data: { traceId: options.traceId, releases, events: inspected.events },
          diagnostics: [],
          exitCode: 0,
        };
      }
      return {
        ok: true,
        data: { traceId: options.traceId, ...inspected },
        diagnostics: [],
        exitCode: 0,
      };
    }

    if (options.subcommand === "flush") {
      const sink = options.sink ?? "local";
      const result = await flushPendingTelemetry(
        adapter,
        sink,
        options.workspaceRoot,
      );
      return {
        ok: result.failed === 0,
        data: result,
        diagnostics: result.diagnostics,
        exitCode: result.failed === 0 ? 0 : 1,
      };
    }

    if (options.subcommand === "clear") {
      const cleared = await clearTelemetryEvents(adapter);
      return {
        ok: true,
        data: { cleared },
        diagnostics: [],
        exitCode: 0,
      };
    }

    return { ok: false, diagnostics: [], exitCode: 1 };
  } finally {
    await adapter.close();
  }
}

export function formatTelemetryJson(result: TelemetryCommandResult): string {
  return `${JSON.stringify({
    ok: result.ok,
    data: result.data,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  })}\n`;
}

export function formatTelemetryHuman(
  subcommand: TelemetrySubcommand,
  result: TelemetryCommandResult,
): string {
  if (!result.ok) {
    return result.diagnostics
      .map((diagnostic) => `error ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n")
      .concat("\n");
  }

  if (subcommand === "flush") {
    const batch = result.data as { processed: number; failed: number };
    return `processed=${batch.processed} failed=${batch.failed}\n`;
  }

  if (subcommand === "clear") {
    return `cleared ${(result.data as { cleared: number }).cleared} telemetry rows\n`;
  }

  if (subcommand === "tail") {
    const tail = result.data as { file: string; lines: string[] };
    return tail.lines.join("\n").concat("\n");
  }

  return `${JSON.stringify(result.data, null, 2)}\n`;
}
