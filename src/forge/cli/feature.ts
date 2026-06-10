import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join, normalize, relative, resolve } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { run } from "../compiler/orchestrator/run.ts";
import { serializeCanonical } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { runMakeCommand } from "./make.ts";
import {
  buildFeaturePlan,
  FEATURE_APPLIED_DIR,
  FEATURE_PLAN_DIR,
  normalizeFeatureId,
  parseFeatureBlueprint,
  readFeaturePlan,
  renderFeatureDiff,
  renderFeaturePlanMarkdown,
  writeFeaturePlan,
  writeText,
} from "../feature/compiler.ts";
import { FEATURE_EXAMPLES } from "../feature/examples.ts";
import type {
  FeatureApplyRecord,
  FeatureCommandOptions,
  FeaturePlan,
  FeatureResult,
} from "../feature/types.ts";

interface SnapshotFile {
  file: string;
  existed: boolean;
  content?: string;
}

interface FeatureSnapshot {
  schemaVersion: "0.1.0";
  featureId: string;
  files: SnapshotFile[];
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
): Diagnostic {
  return createDiagnostic({
    severity,
    code,
    message,
    ...(file ? { file } : {}),
  });
}

function absPath(workspaceRoot: string, file: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, normalize(file));
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`refusing to access outside workspace: ${file}`);
  }
  return absolute;
}

function readText(workspaceRoot: string, file: string): string | null {
  const absolute = absPath(workspaceRoot, file);
  if (!existsSync(absolute)) {
    return null;
  }
  return readFileSync(absolute, "utf8");
}

function snapshotPath(plan: FeaturePlan): string {
  return `${FEATURE_PLAN_DIR}/${plan.id}/snapshot.json`;
}

function appliedPath(featureId: string): string {
  return `${FEATURE_APPLIED_DIR}/${featureId}.json`;
}

function readAppliedRecord(workspaceRoot: string, featureId: string): FeatureApplyRecord | null {
  const content = readText(workspaceRoot, appliedPath(featureId));
  return content ? (JSON.parse(content) as FeatureApplyRecord) : null;
}

function listAppliedRecords(workspaceRoot: string): FeatureApplyRecord[] {
  const dir = absPath(workspaceRoot, FEATURE_APPLIED_DIR);
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf8")) as FeatureApplyRecord);
}

function writeSnapshot(workspaceRoot: string, plan: FeaturePlan): void {
  const files = plan.rollback.trackedFiles.map((file): SnapshotFile => {
    const content = readText(workspaceRoot, file);
    return {
      file,
      existed: content !== null,
      ...(content !== null ? { content } : {}),
    };
  });
  const snapshot: FeatureSnapshot = {
    schemaVersion: "0.1.0",
    featureId: plan.id,
    files,
  };
  writeText(workspaceRoot, snapshotPath(plan), serializeCanonical(snapshot));
}

function restoreSnapshot(workspaceRoot: string, plan: FeaturePlan): Diagnostic[] {
  const raw = readText(workspaceRoot, snapshotPath(plan));
  if (!raw) {
    return [
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        `missing snapshot for feature '${plan.id}'`,
      ),
    ];
  }
  const snapshot = JSON.parse(raw) as FeatureSnapshot;
  for (const file of snapshot.files) {
    if (file.existed) {
      writeText(workspaceRoot, file.file, file.content ?? "");
    } else {
      rmSync(absPath(workspaceRoot, file.file), { force: true });
    }
  }
  return [];
}

async function runGenerateChecks(options: FeatureCommandOptions): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = [];
  if (!options.noGenerate) {
    const generated = await run({
      workspaceRoot: options.workspaceRoot,
      check: false,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    diagnostics.push(...generated.errors, ...generated.warnings);
  }
  if (!options.noVerify) {
    const check = await run({
      workspaceRoot: options.workspaceRoot,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
    diagnostics.push(...check.errors, ...check.warnings);
    if (check.exitCode !== 0) {
      diagnostics.push(
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          "post-apply forge generate --check failed",
        ),
      );
    }
  }
  return diagnostics;
}

function buildPlanFromOptions(options: FeatureCommandOptions): FeatureResult {
  if (!options.blueprintPath) {
    return {
      ok: false,
      diagnostics: [
        diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", "feature command requires a blueprint path"),
      ],
      exitCode: 1,
    };
  }
  const parsed = parseFeatureBlueprint(options.workspaceRoot, options.blueprintPath);
  if (!parsed.blueprint) {
    return { ok: false, diagnostics: parsed.diagnostics, exitCode: 1 };
  }
  const plan = buildFeaturePlan(options.workspaceRoot, parsed.blueprint);
  const diagnostics = [...parsed.diagnostics, ...plan.diagnostics];
  const ok = !diagnostics.some((item) => item.severity === "error");
  return {
    ok,
    blueprint: parsed.blueprint,
    plan,
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

async function applyFeature(options: FeatureCommandOptions): Promise<FeatureResult> {
  const planned = buildPlanFromOptions(options);
  if (!planned.plan || !planned.blueprint) {
    return planned;
  }
  const existing = readAppliedRecord(options.workspaceRoot, planned.plan.id);
  if (existing?.blueprintHash === planned.plan.blueprintHash) {
    return {
      ok: true,
      plan: planned.plan,
      record: existing,
      explanation: `Feature ${planned.plan.id} already applied with same blueprint hash. Nothing to do.`,
      diagnostics: [],
      exitCode: 0,
    };
  }
  if (existing && existing.blueprintHash !== planned.plan.blueprintHash && !options.update) {
    return {
      ok: false,
      plan: planned.plan,
      record: existing,
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_FEATURE_HASH_MISMATCH",
          `feature '${planned.plan.id}' exists with a different blueprint hash; use --update to apply changes`,
        ),
      ],
      exitCode: 1,
    };
  }
  if (planned.plan.risk.level === "high" && !options.allowHighRisk) {
    return {
      ok: false,
      plan: planned.plan,
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `feature '${planned.plan.id}' is high risk; rerun with --allow-high-risk`,
        ),
      ],
      exitCode: 1,
    };
  }
  if (options.dryRun || !options.yes) {
    writeFeaturePlan(options.workspaceRoot, planned.plan);
    return {
      ...planned,
      explanation: options.dryRun
        ? "Dry run only; no files were changed."
        : "Plan written. Rerun with --yes to apply.",
    };
  }

  writeFeaturePlan(options.workspaceRoot, planned.plan);
  writeSnapshot(options.workspaceRoot, planned.plan);

  const diagnostics: Diagnostic[] = [...planned.diagnostics];
  for (const makeOption of planned.plan.makeOptions) {
    const result = await runMakeCommand({
      ...makeOption,
      dryRun: false,
      apply: true,
      yes: true,
      noGenerate: true,
      noVerify: true,
      keepFailed: true,
    });
    diagnostics.push(...result.diagnostics);
    if (!result.ok) {
      break;
    }
  }

  if (!diagnostics.some((item) => item.severity === "error")) {
    diagnostics.push(...await runGenerateChecks(options));
  }

  let ok = !diagnostics.some((item) => item.severity === "error");
  if (!ok && !options.keepFailed) {
    diagnostics.push(...restoreSnapshot(options.workspaceRoot, planned.plan));
  }

  ok = !diagnostics.some((item) => item.severity === "error");
  const record: FeatureApplyRecord = {
    schemaVersion: "0.1.0",
    featureId: planned.plan.id,
    blueprintName: planned.plan.blueprintName,
    blueprintHash: planned.plan.blueprintHash,
    status: ok ? "applied" : "rolled-back",
    filesCreated: planned.plan.filesToCreate.map((file) => file.file).sort(),
    filesModified: planned.plan.filesToModify.map((patch) => patch.file).sort(),
    commandsRun: planned.plan.commandsToRun,
    result: { ok },
  };
  writeText(options.workspaceRoot, appliedPath(planned.plan.id), serializeCanonical(record));

  return {
    ok,
    plan: planned.plan,
    record,
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

function inspectFeature(options: FeatureCommandOptions): FeatureResult {
  const featureId = options.featureId ?? "";
  const record = readAppliedRecord(options.workspaceRoot, featureId);
  const plan = readFeaturePlan(options.workspaceRoot, featureId) ?? undefined;
  if (!record && !plan) {
    return {
      ok: false,
      diagnostics: [
        diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", `feature '${featureId}' was not found`),
      ],
      exitCode: 1,
    };
  }
  return { ok: true, record: record ?? undefined, plan, diagnostics: [], exitCode: 0 };
}

async function rollbackFeature(options: FeatureCommandOptions): Promise<FeatureResult> {
  const featureId = options.featureId ?? "";
  const plan = readFeaturePlan(options.workspaceRoot, featureId);
  if (!plan) {
    return {
      ok: false,
      diagnostics: [
        diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", `feature plan '${featureId}' was not found`),
      ],
      exitCode: 1,
    };
  }
  const diagnostics = restoreSnapshot(options.workspaceRoot, plan);
  if (!options.noGenerate) {
    diagnostics.push(...await runGenerateChecks({ ...options, noVerify: true }));
  }
  const ok = !diagnostics.some((item) => item.severity === "error");
  const record = readAppliedRecord(options.workspaceRoot, plan.id);
  if (record) {
    record.status = "rolled-back";
    record.result = { ok };
    writeText(options.workspaceRoot, appliedPath(plan.id), serializeCanonical(record));
  }
  return {
    ok,
    plan,
    record: record ?? undefined,
    diagnostics,
    explanation: `Rolled back feature ${plan.id}.`,
    exitCode: ok ? 0 : 1,
  };
}

function examples(options: FeatureCommandOptions): FeatureResult {
  const names = Object.keys(FEATURE_EXAMPLES).sort();
  if (!options.exampleName) {
    return { ok: true, examples: names, diagnostics: [], exitCode: 0 };
  }
  const example = FEATURE_EXAMPLES[options.exampleName];
  if (!example) {
    return {
      ok: false,
      examples: names,
      diagnostics: [
        diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", `unknown feature example '${options.exampleName}'`),
      ],
      exitCode: 1,
    };
  }
  if (options.writePath) {
    writeText(options.workspaceRoot, options.writePath, serializeCanonical(example));
  }
  return {
    ok: true,
    blueprint: example,
    examples: names,
    explanation: options.writePath ? `Wrote ${options.writePath}` : undefined,
    diagnostics: [],
    exitCode: 0,
  };
}

export async function runFeatureCommand(options: FeatureCommandOptions): Promise<FeatureResult> {
  if (options.action === "examples") {
    return examples(options);
  }
  if (options.action === "list") {
    return {
      ok: true,
      records: listAppliedRecords(options.workspaceRoot),
      diagnostics: [],
      exitCode: 0,
    };
  }
  if (options.action === "inspect") {
    return inspectFeature(options);
  }
  if (options.action === "rollback") {
    return rollbackFeature(options);
  }

  const planned = buildPlanFromOptions(options);
  if (options.action === "validate") {
    return {
      ok: planned.ok,
      blueprint: planned.blueprint,
      diagnostics: planned.diagnostics,
      exitCode: planned.exitCode,
    };
  }
  if (options.action === "plan") {
    if (planned.plan && planned.ok) {
      writeFeaturePlan(options.workspaceRoot, planned.plan);
    }
    return planned;
  }
  if (options.action === "diff") {
    return {
      ...planned,
      diff: planned.plan ? renderFeatureDiff(planned.plan) : undefined,
    };
  }
  if (options.action === "apply") {
    return applyFeature(options);
  }
  return {
    ok: false,
    diagnostics: [
      diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", `unsupported feature action ${options.action}`),
    ],
    exitCode: 1,
  };
}

export function formatFeatureJson(result: FeatureResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

function formatDiagnostics(diagnostics: Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return "";
  }
  return `\nDiagnostics:\n${diagnostics
    .map((item) => `- ${item.severity} ${item.code}: ${item.message}`)
    .join("\n")}\n`;
}

export function formatFeatureHuman(result: FeatureResult): string {
  if (result.examples && !result.blueprint) {
    return `Available examples:\n${result.examples.map((name) => `- ${name}`).join("\n")}\n${formatDiagnostics(result.diagnostics)}`;
  }
  if (result.diff) {
    return result.diff;
  }
  if (result.plan) {
    const lines = [
      `Feature plan: ${result.plan.blueprintName}`,
      "",
      result.plan.summary,
      "",
      `Risk: ${result.plan.risk.level}`,
      "",
      "Creates:",
      ...(result.plan.filesToCreate.length > 0
        ? result.plan.filesToCreate.map((file) => `- ${file.file}`)
        : ["- none"]),
      "",
      "Modifies:",
      ...(result.plan.filesToModify.length > 0
        ? result.plan.filesToModify.map((patch) => `- ${patch.file}`)
        : ["- none"]),
    ];
    if (result.record) {
      lines.push("", `Status: ${result.record.status}`);
    }
    if (result.explanation) {
      lines.push("", result.explanation);
    }
    return `${lines.join("\n")}\n${formatDiagnostics(result.diagnostics)}`;
  }
  if (result.records) {
    return `Applied features:\n${result.records.map((record) => `- ${record.featureId} ${record.status}`).join("\n") || "- none"}\n`;
  }
  return `Feature ${result.ok ? "ok" : "failed"}\n${result.explanation ?? ""}${formatDiagnostics(result.diagnostics)}`;
}

export { renderFeaturePlanMarkdown };
