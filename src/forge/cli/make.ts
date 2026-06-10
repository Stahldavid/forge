import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { run } from "../compiler/orchestrator/run.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { planMakeCommand, rollbackMakePlan } from "../make/index.ts";
import type { MakeCommandOptions, MakeResult } from "../make/types.ts";

function appendDiagnostics(result: MakeResult, diagnostics: Diagnostic[]): MakeResult {
  const all = [...result.diagnostics, ...diagnostics];
  return {
    ...result,
    ok: !all.some((diagnostic) => diagnostic.severity === "error"),
    diagnostics: all,
    exitCode: all.some((diagnostic) => diagnostic.severity === "error") ? 1 : result.exitCode,
  };
}

async function runPostApplyChecks(
  options: MakeCommandOptions,
  result: MakeResult,
): Promise<MakeResult> {
  if (!result.applied || !result.plan || !result.ok) {
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
    const generatedCheck = await run({
      workspaceRoot: options.workspaceRoot,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    const diagnostics = [...generatedCheck.errors, ...generatedCheck.warnings];
    if (generatedCheck.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_MAKE_VERIFY_FAILED",
          message: "post-apply forge generate --check failed",
        }),
      );
    }
    current = appendDiagnostics(current, diagnostics);
  }

  if (!current.ok && !options.keepFailed) {
    const rollback = rollbackMakePlan(options.workspaceRoot, result.plan.id);
    current = {
      ...current,
      applied: false,
      explanation: `${current.explanation ?? ""}${current.explanation ? "\n" : ""}Rolled back failed make plan ${result.plan.id}.`,
      diagnostics: [...current.diagnostics, ...rollback.diagnostics],
    };
  }

  return current;
}

export async function runMakeCommand(options: MakeCommandOptions): Promise<MakeResult> {
  const result = planMakeCommand(options);
  return runPostApplyChecks(options, result);
}

export function formatMakeJson(result: MakeResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return `\nDiagnostics:\n${diagnostics
    .map((diagnostic) => `- ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`)
    .join("\n")}\n`;
}

export function formatMakeHuman(result: MakeResult): string {
  if (result.primitives) {
    return `Forge make primitives:\n${result.primitives.map((primitive) => `- ${primitive}`).join("\n")}\n`;
  }

  if (result.explanation && !result.plan) {
    return `${result.explanation}\n${formatDiagnostics(result.diagnostics)}`;
  }

  if (!result.plan) {
    return `Forge make ${result.ok ? "ok" : "failed"}\n${formatDiagnostics(result.diagnostics)}`;
  }

  const plan = result.plan;
  const lines = [
    `Forge Make ${result.applied ? "Applied" : "Plan"}`,
    "",
    plan.summary,
    `Plan id: ${plan.id}`,
    `Risk: ${plan.risk.level}`,
    "",
    "Files to create:",
    ...(plan.filesToCreate.length > 0
      ? plan.filesToCreate.map((file) => `- ${file.file}`)
      : ["- none"]),
    "",
    "Files to modify:",
    ...(plan.filesToModify.length > 0
      ? plan.filesToModify.map((file) => `- ${file.file}`)
      : ["- none"]),
  ];

  if (result.planPath) {
    lines.push("", `Saved plan: ${result.planPath}`);
  }
  if (plan.commandsToRun.length > 0) {
    lines.push("", "Commands:", ...plan.commandsToRun.map((command) => `- ${command}`));
  }
  if (result.explanation) {
    lines.push("", result.explanation);
  }

  return `${lines.join("\n")}\n${formatDiagnostics(result.diagnostics)}`;
}
