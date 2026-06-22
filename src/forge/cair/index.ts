import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { runCairActionScript, statActionInput } from "./actions.ts";
import { buildCairSnapshot } from "./snapshot.ts";
import { runCairQuery } from "./query.ts";
import type { CairCommandOptions, CairCommandResult, CairSnapshotLimits } from "./types.ts";

export {
  CAIR_SCHEMA_VERSION,
  type CairCommandOptions,
  type CairOutputFormat,
  type CairSubcommand,
} from "./types.ts";
export { buildCairSnapshot } from "./snapshot.ts";
export { formatCairHuman, formatCairJson, formatCairSnapshotText } from "./format.ts";
export { runCairQuery } from "./query.ts";
export { runCairActionScript, splitCairActionScript } from "./actions.ts";

const QUERY_LIMITS: CairSnapshotLimits = {
  modules: 1_000_000,
  symbols: 1_000_000,
  packages: 1_000_000,
  apis: 1_000_000,
  tests: 1_000_000,
};

export function runCairCommand(options: CairCommandOptions): CairCommandResult {
  const snapshot = buildCairSnapshot(
    options.workspaceRoot,
    options.subcommand === "query" || options.subcommand === "action" ? QUERY_LIMITS : undefined,
  );
  if (options.subcommand === "query") {
    const query = runCairQuery(snapshot, options.query ?? "Q HELP", options.workspaceRoot);
    const diagnostics = [...snapshot.diagnostics, ...query.diagnostics];
    const ok = query.ok && !diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      ok,
      subcommand: options.subcommand,
      snapshot,
      query,
      observations: query.observations,
      diagnostics,
      nextActions: snapshot.nextActions,
      exitCode: ok ? 0 : 1,
    };
  }
  if (options.subcommand === "action") {
    let script = options.action ?? "";
    const inputPath = options.inputPath;
    const inputDiagnostics: Diagnostic[] = [];
    if (inputPath) {
      try {
        script = statActionInput(options.workspaceRoot, inputPath);
      } catch (error) {
        inputDiagnostics.push(createDiagnostic({
          severity: "error",
          code: "FORGE_CAIR_ACTION_INPUT",
          message: error instanceof Error ? error.message : String(error),
        }));
      }
    }
    const action = inputDiagnostics.length === 0
      ? runCairActionScript({
        workspaceRoot: options.workspaceRoot,
        snapshot,
        script,
        dryRun: (options.dryRun ?? false) || (options.plan ?? false),
        plan: options.plan ?? false,
        allowGenerated: options.allowGenerated ?? false,
      })
      : {
        ok: false,
        dryRun: (options.dryRun ?? false) || (options.plan ?? false),
        plan: options.plan ?? false,
        actionCount: 0,
        steps: [],
        observations: [],
        diagnostics: inputDiagnostics,
        journalPaths: [],
        planPaths: [],
      };
    const diagnostics = [...snapshot.diagnostics, ...action.diagnostics];
    const ok = action.ok && !diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      ok,
      subcommand: options.subcommand,
      snapshot,
      action,
      observations: action.observations,
      diagnostics,
      nextActions: snapshot.nextActions,
      exitCode: ok ? 0 : 1,
    };
  }

  const ok = !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    ok,
    subcommand: options.subcommand,
    snapshot,
    observations: [],
    diagnostics: snapshot.diagnostics,
    nextActions: snapshot.nextActions,
    exitCode: ok ? 0 : 1,
  };
}
