import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { run } from "../compiler/orchestrator/run.ts";
import {
  applyRefactorPlan,
  buildRefactorPlan,
  listRefactors,
  readRefactorPlan,
  renderRefactorDiff,
  rollbackRefactor,
  writeRefactorPlan,
} from "../refactor/index.ts";
import type { RefactorCommandOptions, RefactorResult } from "../refactor/types.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";

function appendDiagnostics(result: RefactorResult, diagnostics: Diagnostic[]): RefactorResult {
  const all = [...result.diagnostics, ...diagnostics];
  return {
    ...result,
    ok: !all.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics: all,
    exitCode: all.some((diagnostic) => diagnostic.severity === "error") ? 1 : result.exitCode,
  };
}

async function runPostApplyChecks(options: RefactorCommandOptions, result: RefactorResult): Promise<RefactorResult> {
  if (!result.ok || !result.plan || !result.record || result.record.status !== "applied") {
    return result;
  }
  let current = result;
  if (!options.noGenerate) {
    const generated = await run({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    current = appendDiagnostics(current, [...generated.errors, ...generated.warnings]);
  }
  if (!options.noVerify && current.ok) {
    const check = await run({
      workspaceRoot: options.workspaceRoot,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    const diagnostics = [...check.errors, ...check.warnings];
    if (check.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_REFACTOR_VERIFY_FAILED",
          message: "post-refactor forge generate --check failed",
        }),
      );
    }
    current = appendDiagnostics(current, diagnostics);
  }
  if (!current.ok && !options.keepFailed) {
    const rollback = rollbackRefactor(options.workspaceRoot, result.plan.id);
    current = appendDiagnostics(
      {
        ...current,
        explanation: `Rolled back failed refactor ${result.plan.id}.`,
      },
      rollback.diagnostics,
    );
  }
  return current;
}

export async function runRefactorCommand(options: RefactorCommandOptions): Promise<RefactorResult> {
  if (options.action === "list") {
    return {
      ok: true,
      records: listRefactors(options.workspaceRoot),
      diagnostics: [],
      exitCode: 0,
    };
  }
  if (options.action === "rollback") {
    if (!options.planId) {
      return {
        ok: false,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "FORGE_REFACTOR_TARGET_NOT_FOUND",
            message: "forge refactor rollback requires a plan id",
          }),
        ],
        exitCode: 1,
      };
    }
    return rollbackRefactor(options.workspaceRoot, options.planId);
  }
  if (options.action === "diff" || options.action === "apply") {
    const fromDisk = options.planId ? readRefactorPlan(options.workspaceRoot, options.planId) : null;
    const planned = fromDisk
      ? { ok: true, plan: fromDisk, diagnostics: [], exitCode: 0 as const }
      : buildRefactorPlan(options);
    if (!planned.plan) {
      return planned;
    }
    if (options.action === "diff") {
      return {
        ...planned,
        diff: renderRefactorDiff(planned.plan),
      };
    }
    if (planned.plan.risk.level === "high" && !options.allowHighRisk) {
      return {
        ok: false,
        plan: planned.plan,
        diagnostics: [
          createDiagnostic({
            severity: "error",
            code: "FORGE_REFACTOR_HIGH_RISK",
            message: `refactor ${planned.plan.id} is high risk; rerun with --allow-high-risk`,
          }),
        ],
        exitCode: 1,
      };
    }
    if (options.dryRun || !options.yes) {
      writeRefactorPlan(options.workspaceRoot, planned.plan);
      return {
        ...planned,
        explanation: options.dryRun
          ? "Dry run only; no files were changed."
          : "Plan written. Rerun with --yes to apply.",
      };
    }
    return runPostApplyChecks(
      options,
      applyRefactorPlan(options.workspaceRoot, planned.plan, options.force),
    );
  }

  const planned = buildRefactorPlan(options);
  if (planned.plan && (options.plan || options.dryRun || !options.yes)) {
    writeRefactorPlan(options.workspaceRoot, planned.plan);
  }
  if (!planned.plan || planned.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return planned;
  }
  if (options.dryRun || !options.yes) {
    return {
      ...planned,
      explanation: options.dryRun
        ? "Dry run only; no files were changed."
        : "Plan written. Rerun with --yes to apply.",
    };
  }
  if (planned.plan.risk.level === "high" && !options.allowHighRisk) {
    return {
      ok: false,
      plan: planned.plan,
      diagnostics: [
        createDiagnostic({
          severity: "error",
          code: "FORGE_REFACTOR_HIGH_RISK",
          message: `refactor ${planned.plan.id} is high risk; rerun with --allow-high-risk`,
        }),
      ],
      exitCode: 1,
    };
  }
  return runPostApplyChecks(
    options,
    applyRefactorPlan(options.workspaceRoot, planned.plan, options.force),
  );
}

export function formatRefactorJson(result: RefactorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return `\nDiagnostics:\n${diagnostics.map((diagnostic) => `- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`).join("\n")}\n`;
}

export function formatRefactorHuman(result: RefactorResult): string {
  if (result.diff) {
    return result.diff;
  }
  if (result.records) {
    return `Refactors:\n${result.records.map((record) => `- ${record.id} ${record.status}`).join("\n") || "- none"}\n`;
  }
  if (!result.plan) {
    return `Refactor ${result.ok ? "ok" : "failed"}\n${result.explanation ?? ""}${formatDiagnostics(result.diagnostics)}`;
  }
  const lines = [
    `Refactor plan: ${result.plan.id}`,
    "",
    result.plan.summary,
    "",
    `Risk: ${result.plan.risk.level}`,
    "",
    "Will modify:",
    ...(result.plan.filesToModify.length > 0
      ? result.plan.filesToModify.map((patch) => `- ${patch.file}`)
      : ["- none"]),
    "",
    "Will create:",
    ...(result.plan.filesToCreate.length > 0
      ? result.plan.filesToCreate.map((file) => `- ${file.file}`)
      : ["- none"]),
  ];
  if (result.plan.migrationPlan) {
    lines.push("", "Migration hint:", ...result.plan.migrationPlan.sql.map((sql) => `- ${sql}`));
  }
  if (result.explanation) {
    lines.push("", result.explanation);
  }
  return `${lines.join("\n")}\n${formatDiagnostics(result.diagnostics)}`;
}
