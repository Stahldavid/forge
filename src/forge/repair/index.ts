import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson, serializeCanonical } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { resolveBunExecutable } from "../cli/bun-exec.ts";
import type { TestRunRecord } from "../impact/types.ts";
import { explainDiagnostic, repairRules } from "./rules/index.ts";
import type {
  FailureInput,
  RepairApplyRecord,
  RepairCommandOptions,
  RepairDiagnosis,
  RepairPlan,
  RepairResult,
  SuggestedRepair,
} from "./types.ts";

export const REPAIR_DIR = ".forge/repairs";
const REPAIR_VERSION = "repair-0.1.0";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
): Diagnostic {
  return createDiagnostic({ severity, code, message, ...(file ? { file } : {}) });
}

function readJson<T>(workspaceRoot: string, relative: string): T | null {
  const absolute = join(workspaceRoot, relative);
  if (!existsSync(absolute)) {
    return null;
  }
  return JSON.parse(readFileSync(absolute, "utf8")) as T;
}

function writeJson(workspaceRoot: string, relative: string, value: unknown): void {
  const absolute = join(workspaceRoot, relative);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, serializeCanonical(value), "utf8");
}

function repairPath(id: string, file: string): string {
  return `${REPAIR_DIR}/${id}/${file}`;
}

function emptyInput(source: FailureInput["source"]): FailureInput {
  return {
    source,
    diagnostics: [],
    failedCommands: [],
    stdout: "",
    stderr: "",
  };
}

function parseDiagnosticsFromText(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const codeRegex = /\bFORGE_[A-Z0-9_]+\b/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = codeRegex.exec(text))) {
    const code = match[0];
    if (seen.has(code)) {
      continue;
    }
    seen.add(code);
    const line = text
      .slice(Math.max(0, match.index - 160), Math.min(text.length, match.index + 220))
      .split(/\r?\n/)
      .find((candidate) => candidate.includes(code));
    diagnostics.push(
      diagnostic("error", code, line?.trim() || `Detected ${code}`),
    );
  }
  return diagnostics;
}

function inputFromTestRun(record: TestRunRecord, file: string): FailureInput {
  const failedResults = record.results.filter((result) => !result.ok);
  const stdout = failedResults.map((result) => result.stdout ?? "").join("\n");
  const stderr = failedResults.map((result) => result.stderr ?? "").join("\n");
  const diagnostics = parseDiagnosticsFromText(`${stdout}\n${stderr}`);
  return {
    source: { kind: "test-run", id: record.id, file },
    diagnostics,
    failedCommands: failedResults.map((result) => result.command),
    stdout,
    stderr,
  };
}

function collectFailureInput(options: RepairCommandOptions): FailureInput | null {
  if (options.diagnosticCode) {
    return {
      ...emptyInput({ kind: "diagnostic", id: options.diagnosticCode }),
      diagnostics: [
        diagnostic(
          "error",
          options.diagnosticCode,
          explainDiagnostic(options.diagnosticCode),
        ),
      ],
      stdout: options.diagnosticCode,
    };
  }
  if (options.traceId) {
    return {
      ...emptyInput({ kind: "trace", id: options.traceId }),
      stdout: `trace ${options.traceId}`,
    };
  }
  if (options.workflowRunId) {
    return {
      ...emptyInput({ kind: "workflow-run", id: options.workflowRunId }),
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_WORKFLOW_STEP_FAILED",
          `Workflow run ${options.workflowRunId} failed or needs inspection`,
        ),
      ],
      stdout: `FORGE_WORKFLOW_STEP_FAILED workflow run ${options.workflowRunId}`,
    };
  }
  if (options.outboxDeliveryId) {
    return {
      ...emptyInput({ kind: "outbox-delivery", id: options.outboxDeliveryId }),
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_OUTBOX_PROCESS_FAILED",
          `Outbox delivery ${options.outboxDeliveryId} failed or is dead-lettered`,
        ),
      ],
      stdout: `FORGE_OUTBOX_PROCESS_FAILED delivery ${options.outboxDeliveryId}`,
    };
  }

  const file = options.fromLastTestRun ? ".forge/test-runs/last.json" : options.from;
  if (file) {
    const record = readJson<TestRunRecord>(options.workspaceRoot, file);
    if (!record) {
      return null;
    }
    return inputFromTestRun(record, file);
  }

  return emptyInput({ kind: "manual" });
}

function fallbackDiagnosis(input: FailureInput): RepairDiagnosis {
  const id = `repair_${hashStable(canonicalJson(input)).slice(0, 12)}`;
  return {
    schemaVersion: "0.1.0",
    repairVersion: REPAIR_VERSION,
    id,
    failureKind: input.failedCommands.some((command) => command.includes("typecheck"))
      ? "typecheck"
      : input.failedCommands.length > 0
        ? "test-failure"
        : "unknown",
    source: input.source,
    diagnostics:
      input.diagnostics.length > 0
        ? input.diagnostics
        : [
            diagnostic(
              "warning",
              "FORGE_REPAIR_NO_RULE_MATCHED",
              "No deterministic repair rule matched this failure.",
            ),
          ],
    summary: "No deterministic repair rule matched this failure.",
    likelyCause: "The failure does not match a known ForgeOS repair pattern yet. Inspect the failing command output and affected files.",
    affected: {
      files: [],
      commands: [],
      queries: [],
      liveQueries: [],
      actions: [],
      workflows: [],
      tables: [],
      policies: [],
      components: [],
      packages: [],
    },
    suggestedRepairs: [
      {
        id: "manual-review",
        kind: "manual",
        title: "Manual review required",
        description: "Read the failing output, inspect impacted files, then rerun forge test plan --changed.",
        confidence: "low",
        risk: { level: "medium", reasons: ["unknown failure class"] },
        requiresConfirmation: true,
      },
    ],
    recommendedChecks: ["forge test plan --changed", "forge verify --strict"],
    confidence: "low",
  };
}

export function diagnoseRepair(options: RepairCommandOptions): RepairResult {
  const input = collectFailureInput(options);
  if (!input) {
    const source = options.fromLastTestRun ? ".forge/test-runs/last.json" : options.from ?? "<unknown>";
    const diag = diagnostic(
      "error",
      "FORGE_REPAIR_SOURCE_NOT_FOUND",
      `repair source not found: ${source}`,
      source,
    );
    return { ok: false, diagnostics: [diag], exitCode: 1 };
  }

  const rule = repairRules.find((candidate) => candidate.matches(input));
  const diagnosis = rule?.diagnose(input) ?? fallbackDiagnosis(input);
  return {
    ok: diagnosis.confidence !== "low" || diagnosis.failureKind !== "unknown",
    diagnosis,
    diagnostics: diagnosis.diagnostics,
    exitCode: 0,
  };
}

function planFromDiagnosis(diagnosis: RepairDiagnosis, selectedRepair?: string): RepairPlan {
  const selected =
    diagnosis.suggestedRepairs.find((repair) => repair.id === selectedRepair) ??
    diagnosis.suggestedRepairs[0];
  const commands = selected?.command ? [selected.command] : [];
  const id = diagnosis.id;
  return {
    schemaVersion: "0.1.0",
    repairVersion: REPAIR_VERSION,
    id,
    diagnosis,
    selectedRepair: selected?.id,
    filesToModify: selected?.patchPreview ?? [],
    filesToCreate: [],
    filesToDelete: [],
    commandsToRun: commands,
    verificationPlan: {
      targeted: ["forge test plan --changed", "forge test run --changed"],
      final: ["forge verify --strict"],
    },
    rollback: {
      snapshotFile: repairPath(id, "rollback.json"),
      files: diagnosis.affected.files,
      instructions: [`forge repair rollback ${id}`],
    },
    diagnostics: [],
  };
}

export function writeRepairPlan(workspaceRoot: string, plan: RepairPlan): void {
  writeJson(workspaceRoot, repairPath(plan.id, "diagnosis.json"), plan.diagnosis);
  writeJson(workspaceRoot, repairPath(plan.id, "plan.json"), plan);
  const md = renderRepairPlanMarkdown(plan);
  const absolute = join(workspaceRoot, repairPath(plan.id, "plan.md"));
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, md, "utf8");
}

export function buildRepairPlan(options: RepairCommandOptions): RepairResult {
  const diagnosed = diagnoseRepair(options);
  if (!diagnosed.diagnosis) {
    return diagnosed;
  }
  const plan = planFromDiagnosis(diagnosed.diagnosis, options.selectedRepair);
  if (options.write || options.subcommand === "plan") {
    writeRepairPlan(options.workspaceRoot, plan);
  }
  return {
    ok: true,
    diagnosis: diagnosed.diagnosis,
    plan,
    diagnostics: plan.diagnostics,
    exitCode: 0,
  };
}

function loadRepairPlan(workspaceRoot: string, idOrPath: string): RepairPlan | null {
  const candidates = [
    idOrPath,
    repairPath(idOrPath, "plan.json"),
  ];
  for (const candidate of candidates) {
    const plan = readJson<RepairPlan>(workspaceRoot, candidate);
    if (plan) {
      return plan;
    }
  }
  return null;
}

export function listRepairPlans(workspaceRoot: string): RepairPlan[] {
  const absolute = join(workspaceRoot, REPAIR_DIR);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute)
    .map((entry) => readJson<RepairPlan>(workspaceRoot, repairPath(entry, "plan.json")))
    .filter((plan): plan is RepairPlan => Boolean(plan))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function commandArgs(command: string): { executable: string; args: string[] } {
  const bun = resolveBunExecutable();
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts[0] === "forge") {
    return { executable: bun, args: ["src/forge/cli/main.ts", ...parts.slice(1)] };
  }
  if (parts[0] === "bun") {
    return { executable: bun, args: parts.slice(1) };
  }
  return { executable: parts[0] ?? bun, args: parts.slice(1) };
}

async function runCommand(workspaceRoot: string, command: string): Promise<RepairApplyRecord["results"][number]> {
  const resolved = commandArgs(command);
  return new Promise((resolve) => {
    const child = spawn(resolved.executable, resolved.args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      resolve({ command, ok: false, exitCode: 1, stderr: error.message });
    });
    child.on("close", (code) => {
      resolve({ command, ok: (code ?? 1) === 0, exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function snapshotFiles(workspaceRoot: string, plan: RepairPlan): void {
  const files = plan.rollback.files.filter(Boolean);
  const snapshot = files.map((file) => {
    const absolute = join(workspaceRoot, normalize(file));
    return {
      file: normalize(file),
      existed: existsSync(absolute),
      content: existsSync(absolute) ? readFileSync(absolute, "utf8") : null,
    };
  });
  writeJson(workspaceRoot, plan.rollback.snapshotFile, { files: snapshot });
}

function restoreSnapshot(workspaceRoot: string, plan: RepairPlan): void {
  const snapshot = readJson<{ files: Array<{ file: string; existed: boolean; content: string | null }> }>(
    workspaceRoot,
    plan.rollback.snapshotFile,
  );
  if (!snapshot) {
    return;
  }
  for (const file of snapshot.files) {
    const absolute = join(workspaceRoot, normalize(file.file));
    if (!file.existed) {
      if (existsSync(absolute)) {
        rmSync(absolute, { force: true });
      }
      continue;
    }
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, file.content ?? "", "utf8");
  }
}

function canAutoApply(repair: SuggestedRepair | undefined, options: RepairCommandOptions): boolean {
  if (!repair) {
    return false;
  }
  if (repair.kind === "manual" || repair.kind === "patch") {
    return false;
  }
  if (repair.confidence === "high") {
    return true;
  }
  return repair.confidence === "medium" && options.allowMediumConfidence;
}

export async function applyRepair(options: RepairCommandOptions): Promise<RepairResult> {
  const plan = options.repairId ? loadRepairPlan(options.workspaceRoot, options.repairId) : buildRepairPlan({ ...options, write: true }).plan;
  if (!plan) {
    const diag = diagnostic(
      "error",
      "FORGE_REPAIR_SOURCE_NOT_FOUND",
      `repair plan not found: ${options.repairId ?? "<new plan>"}`,
    );
    return { ok: false, diagnostics: [diag], exitCode: 1 };
  }
  const selected = plan.diagnosis.suggestedRepairs.find((repair) => repair.id === plan.selectedRepair);
  if (!options.yes && selected?.requiresConfirmation) {
    const diag = diagnostic(
      "error",
      "FORGE_REPAIR_UNSAFE_AUTO_APPLY",
      "repair requires confirmation; rerun with --yes",
    );
    return { ok: false, plan, diagnostics: [diag], exitCode: 1 };
  }
  if (!canAutoApply(selected, options)) {
    const diag = diagnostic(
      "error",
      selected?.confidence === "low" ? "FORGE_REPAIR_LOW_CONFIDENCE" : "FORGE_REPAIR_UNSAFE_AUTO_APPLY",
      "repair is not safe for automatic application",
    );
    return { ok: false, plan, diagnostics: [diag], exitCode: 1 };
  }

  snapshotFiles(options.workspaceRoot, plan);
  const results = [];
  for (const command of plan.commandsToRun) {
    const result = await runCommand(options.workspaceRoot, command);
    results.push(result);
    if (!result.ok) {
      break;
    }
  }
  const failed = results.some((result) => !result.ok);
  if (failed && !options.keepFailed) {
    restoreSnapshot(options.workspaceRoot, plan);
  }
  const record: RepairApplyRecord = {
    schemaVersion: "0.1.0",
    id: `apply_${hashStable(`${plan.id}:${canonicalJson(results)}`).slice(0, 12)}`,
    repairId: plan.id,
    status: failed ? "failed" : "applied",
    commandsRun: plan.commandsToRun,
    results,
  };
  writeJson(options.workspaceRoot, repairPath(plan.id, "applied.json"), record);
  return {
    ok: !failed,
    plan,
    record,
    diagnostics: failed
      ? [
          diagnostic(
            "error",
            "FORGE_REPAIR_APPLY_FAILED",
            "repair command failed; rollback was attempted unless --keep-failed was set",
          ),
        ]
      : [],
    exitCode: failed ? 1 : 0,
  };
}

export async function runRepairLoop(options: RepairCommandOptions): Promise<RepairResult> {
  let last: RepairResult = { ok: false, diagnostics: [], exitCode: 1 };
  const attempts = Math.max(1, options.maxAttempts || 1);
  for (let index = 0; index < attempts; index++) {
    const planned = buildRepairPlan({ ...options, subcommand: "plan", write: true });
    if (!planned.plan) {
      return planned;
    }
    last = await applyRepair({
      ...options,
      subcommand: "apply",
      repairId: planned.plan.id,
      yes: true,
    });
    if (!last.ok) {
      return last;
    }
    break;
  }
  return last;
}

export function rollbackRepair(options: RepairCommandOptions): RepairResult {
  const plan = options.repairId ? loadRepairPlan(options.workspaceRoot, options.repairId) : null;
  if (!plan) {
    const diag = diagnostic("error", "FORGE_REPAIR_SOURCE_NOT_FOUND", `repair plan not found: ${options.repairId ?? ""}`);
    return { ok: false, diagnostics: [diag], exitCode: 1 };
  }
  restoreSnapshot(options.workspaceRoot, plan);
  const record: RepairApplyRecord = {
    schemaVersion: "0.1.0",
    id: `rollback_${hashStable(plan.id).slice(0, 12)}`,
    repairId: plan.id,
    status: "rolled-back",
    commandsRun: [],
    results: [],
  };
  writeJson(options.workspaceRoot, repairPath(plan.id, "applied.json"), record);
  return { ok: true, plan, record, diagnostics: [], exitCode: 0 };
}

export async function runRepairCommand(options: RepairCommandOptions): Promise<RepairResult> {
  if (options.subcommand === "explain") {
    return {
      ok: true,
      explanation: explainDiagnostic(options.diagnosticCode ?? options.repairId ?? ""),
      diagnostics: [],
      exitCode: 0,
    };
  }
  if (options.subcommand === "diagnose") {
    const result = diagnoseRepair(options);
    if (result.diagnosis && options.write) {
      writeJson(options.workspaceRoot, repairPath(result.diagnosis.id, "diagnosis.json"), result.diagnosis);
    }
    return result;
  }
  if (options.subcommand === "plan") {
    return buildRepairPlan(options);
  }
  if (options.subcommand === "apply") {
    return applyRepair(options);
  }
  if (options.subcommand === "run") {
    return runRepairLoop(options);
  }
  if (options.subcommand === "list") {
    return { ok: true, plans: listRepairPlans(options.workspaceRoot), diagnostics: [], exitCode: 0 };
  }
  if (options.subcommand === "inspect") {
    const plan = options.repairId ? loadRepairPlan(options.workspaceRoot, options.repairId) : null;
    if (!plan) {
      const diag = diagnostic("error", "FORGE_REPAIR_SOURCE_NOT_FOUND", `repair plan not found: ${options.repairId ?? ""}`);
      return { ok: false, diagnostics: [diag], exitCode: 1 };
    }
    return { ok: true, plan, diagnosis: plan.diagnosis, diagnostics: [], exitCode: 0 };
  }
  if (options.subcommand === "rollback") {
    return rollbackRepair(options);
  }
  return { ok: false, diagnostics: [diagnostic("error", "FORGE_REPAIR_UNKNOWN_FAILURE", "unknown repair command")], exitCode: 1 };
}

export function renderRepairPlanMarkdown(plan: RepairPlan): string {
  const repair = plan.diagnosis.suggestedRepairs.find((candidate) => candidate.id === plan.selectedRepair);
  return `# Repair Plan: ${plan.diagnosis.summary}

Failure kind: ${plan.diagnosis.failureKind}

## Likely Cause

${plan.diagnosis.likelyCause}

## Affected Files

${plan.diagnosis.affected.files.map((file) => `- ${file}`).join("\n") || "- none detected"}

## Suggested Repair

${repair ? `- ${repair.title}: ${repair.description}` : "- manual review"}

${repair?.command ? `\`\`\`bash\n${repair.command}\n\`\`\`` : ""}

## Verification

\`\`\`bash
${plan.verificationPlan.targeted.concat(plan.verificationPlan.final).join("\n")}
\`\`\`
`;
}

export function formatRepairJson(result: RepairResult): string {
  const body = result.record
    ? { ok: result.ok, plan: result.plan, record: result.record, diagnostics: result.diagnostics }
    : result.plan ?? result.diagnosis ?? result.plans ?? { explanation: result.explanation, diagnostics: result.diagnostics };
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function formatRepairHuman(result: RepairResult): string {
  if (result.explanation) {
    return `${result.explanation}\n`;
  }
  if (result.diagnosis && !result.plan) {
    const repair = result.diagnosis.suggestedRepairs[0];
    return `Repair diagnosis

Failure kind:
  ${result.diagnosis.failureKind}

Summary:
  ${result.diagnosis.summary}

Likely cause:
  ${result.diagnosis.likelyCause}

Suggested repair:
  ${repair?.command ?? repair?.description ?? "manual review"}

Next checks:
${result.diagnosis.recommendedChecks.map((check) => `  - ${check}`).join("\n")}
`;
  }
  if (result.plan) {
    return renderRepairPlanMarkdown(result.plan);
  }
  if (result.plans) {
    return `${result.plans.map((plan) => `${plan.id}: ${plan.diagnosis.summary}`).join("\n")}\n`;
  }
  if (result.record) {
    return `Repair ${result.record.status}: ${result.record.repairId}
${result.record.results.map((step) => `${step.ok ? "OK" : "FAIL"} ${step.command}`).join("\n")}
`;
  }
  return `${result.diagnostics.map((diag) => diag.message).join("\n")}\n`;
}
