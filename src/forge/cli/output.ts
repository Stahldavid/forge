import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type {
  ForgeAddResult,
  GenerateResult,
  InspectResult,
  VerifyResult,
} from "../compiler/types/cli.ts";
import { forgeCliCommandsForWorkspace } from "../workspace/forge-cli.ts";
import { uniqueNextActions } from "./next-actions.ts";

function failureKindFromDiagnostics(errors: Diagnostic[]): string | undefined {
  if (errors.length === 0) {
    return undefined;
  }
  return errors.some((error) => error.severity === "error")
    ? "error"
    : undefined;
}

export function attachFailureKind<T extends GenerateResult>(result: T): T {
  return {
    ...result,
    failureKind: result.failureKind ?? failureKindFromDiagnostics(result.errors),
  };
}

export function formatJsonResult(payload: unknown): string {
  return `${JSON.stringify(payload, null, 2)}\n`;
}

function artifactGroup(path: string): string {
  if (path === "AGENTS.md" || path.includes("/agent") || path.includes("\\agent") || path.includes("agent")) {
    return "agent";
  }
  if (path.includes("frontend") || path.includes("react") || path.includes("vue") || path.includes("ui")) {
    return "frontend";
  }
  if (path.includes("dataGraph") || path.includes("sqlPlan") || path.includes("db.") || path.includes("tenantScope")) {
    return "schema";
  }
  if (path.includes("api") || path.includes("client") || path.includes("runtime")) {
    return "api";
  }
  if (path.startsWith("src/forge/_generated") || path.includes("\\src\\forge\\_generated")) {
    return "generated";
  }
  return "other";
}

function summarizeGeneratedArtifacts(paths: string[]): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const path of paths) {
    const group = artifactGroup(path);
    groups[group] = (groups[group] ?? 0) + 1;
  }
  return groups;
}

function compactList(items: string[], sampleSize = 12): { count: number; sample: string[]; hidden: number } {
  return {
    count: items.length,
    sample: items.slice(0, sampleSize),
    hidden: Math.max(0, items.length - sampleSize),
  };
}

function summarizeDiagnostics(diagnostics: Diagnostic[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    summary[diagnostic.code] = (summary[diagnostic.code] ?? 0) + 1;
  }
  return summary;
}

function buildGenerateNextActions(result: GenerateResult): string[] {
  if (result.exitCode !== 0 && result.errors.length === 0 && result.changed.length > 0) {
    return [
      "forge generate --json",
      "forge generate --check --json",
      "forge changed --review --json",
      "forge check --json",
    ];
  }

  const suggested = new Set<string>();
  for (const diagnostic of [...result.errors, ...result.warnings]) {
    for (const command of diagnostic.suggestedCommands ?? []) {
      suggested.add(command);
    }
  }
  if (result.exitCode !== 0) {
    for (const diagnostic of result.errors.slice(0, 3)) {
      if (!diagnostic.suggestedCommands?.some((command) => command.includes("forge repair diagnose"))) {
        suggested.add(`forge repair diagnose --diagnostic ${diagnostic.code} --json`);
      }
    }
    suggested.add("forge check --json");
    return [...suggested];
  }
  if (result.changed.length > 0) {
    suggested.add("forge check --json");
    suggested.add("forge verify --smoke");
    return [...suggested];
  }
  suggested.add("forge check --json");
  return [...suggested];
}

export function buildGenerateJson(
  result: GenerateResult,
  options: { workspaceRoot?: string } = {},
): Record<string, unknown> {
  const diagnostics = [...result.errors, ...result.warnings];
  const changed = compactList(result.changed);
  const unchanged = compactList(result.unchanged);
  const drift =
    result.exitCode !== 0 && result.errors.length === 0 && result.changed.length > 0
      ? {
          kind: "generated-drift",
          message: `${result.changed.length} generated artifact(s) would change; run forge generate before handoff or verification.`,
          changedGroups: summarizeGeneratedArtifacts(result.changed),
          sampleChanged: changed.sample,
          hiddenChanged: changed.hidden,
          repairCommand: options.workspaceRoot
            ? forgeCliCommandsForWorkspace(options.workspaceRoot, ["forge generate"])[0]
            : "forge generate",
          checkCommand: options.workspaceRoot
            ? forgeCliCommandsForWorkspace(options.workspaceRoot, ["forge generate --check --json"])[0]
            : "forge generate --check --json",
        }
      : null;
  return {
    schemaVersion: "0.1.0",
    ok: result.exitCode === 0,
    summary: {
      changed: result.changed.length,
      unchanged: result.unchanged.length,
      warnings: result.warnings.length,
      errors: result.errors.length,
      changedGroups: summarizeGeneratedArtifacts(result.changed),
      unchangedGroups: summarizeGeneratedArtifacts(result.unchanged),
      changedSample: changed.sample,
      hiddenChanged: changed.hidden,
      unchangedSample: unchanged.sample,
      hiddenUnchanged: unchanged.hidden,
      diagnosticGroups: summarizeDiagnostics(diagnostics),
      ...(drift ? { message: drift.message } : {}),
    },
    ...(drift ? { drift } : {}),
    changed: result.changed,
    unchanged: result.unchanged,
    warnings: result.warnings,
    errors: result.errors,
    diagnostics,
    nextActions: options.workspaceRoot
      ? forgeCliCommandsForWorkspace(options.workspaceRoot, buildGenerateNextActions(result))
      : buildGenerateNextActions(result),
    durationMs: null,
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function buildCheckJson(
  result: GenerateResult,
  options: { workspaceRoot?: string } = {},
): Record<string, unknown> {
  const diagnostics = [...result.errors, ...result.warnings];
  const suggested = new Set<string>();
  for (const diagnostic of diagnostics) {
    for (const command of diagnostic.suggestedCommands ?? []) {
      if (command !== "forge check --json") {
        suggested.add(command);
      }
    }
  }
  if (result.exitCode !== 0) {
    for (const diagnostic of result.errors.slice(0, 3)) {
      suggested.add(`forge repair diagnose --diagnostic ${diagnostic.code} --json`);
    }
    suggested.add("forge generate");
    suggested.add("forge check --json");
  } else {
    suggested.add("forge verify --changed");
    suggested.add("forge handoff --json");
  }
  return {
    schemaVersion: "0.1.0",
    ok: result.exitCode === 0,
    summary: {
      warnings: result.warnings.length,
      errors: result.errors.length,
    },
    warnings: result.warnings,
    errors: result.errors,
    diagnostics,
    nextActions: options.workspaceRoot
      ? forgeCliCommandsForWorkspace(options.workspaceRoot, uniqueNextActions([...suggested]))
      : uniqueNextActions([...suggested]),
    durationMs: null,
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function buildAddJson(
  result: ForgeAddResult,
  options: { workspaceRoot?: string } = {},
): Record<string, unknown> {
  const base = buildGenerateJson(result, options);
  const packageInspectName = result.packageName ?? result.alias;
  const packageNextActions =
    result.mode === "package" && packageInspectName
      ? [
          `forge deps inspect ${packageInspectName} --json`,
          "forge generate",
          "forge check --json",
          "forge verify --smoke",
        ]
      : undefined;
  const integrationNextActions =
    result.exitCode === 0 && result.mode === "integration" && result.targetKind === "forge-integration"
      ? [
          "forge generate",
          ...(result.recipePackages ?? []).map((pkg) => `forge deps inspect ${pkg} --json`),
          ...((result.requiredSecrets?.length ?? 0) > 0 || (result.optionalSecrets?.length ?? 0) > 0
            ? ["forge secrets check --json", "forge inspect secrets --json"]
            : []),
          ...(result.alias === "workos"
            ? [
                "forge workos install --json",
                "forge workos install --yes --json",
                "forge workos doctor --json",
                "forge workos doctor --yes --json",
                "forge workos seed --file workos-seed.yml --dry-run --json",
                "forge workos seed --file workos-seed.yml --json",
                "forge auth check --json",
                "forge auth prove --json",
              ]
            : []),
          "forge check --json",
          "forge verify --smoke",
        ]
      : undefined;
  return {
    alias: result.alias ?? null,
    mode: result.mode ?? null,
    targetKind: result.targetKind ?? null,
    target: result.target ?? null,
    ...(result.packageTarget ? { packageTarget: result.packageTarget } : {}),
    ...(result.packageTargetReason ? { packageTargetReason: result.packageTargetReason } : {}),
    explanation: result.explanation ?? null,
    ...(result.recipeVersion ? { recipeVersion: result.recipeVersion } : {}),
    ...(result.recipePackages ? { recipePackages: result.recipePackages } : {}),
    ...(result.requiredSecrets ? { requiredSecrets: result.requiredSecrets } : {}),
    ...(result.optionalSecrets ? { optionalSecrets: result.optionalSecrets } : {}),
    ...(result.packageSpec ? { packageSpec: result.packageSpec } : {}),
    ...(result.packageName ? { packageName: result.packageName } : {}),
    ...(result.packageManager ? { packageManager: result.packageManager } : {}),
    ...(result.installCommand ? { installCommand: result.installCommand } : {}),
    ...(result.nativeInstallCommand ? { nativeInstallCommand: result.nativeInstallCommand } : {}),
    ...(result.avoidedManualCommand ? { avoidedManualCommand: result.avoidedManualCommand } : {}),
    ...(result.installCwd ? { installCwd: result.installCwd } : {}),
    ...(result.installWorkspace ? { installWorkspace: result.installWorkspace } : {}),
    ...base,
    nextActions: options.workspaceRoot
      ? forgeCliCommandsForWorkspace(options.workspaceRoot, packageNextActions ?? integrationNextActions ?? (base.nextActions as string[]))
      : packageNextActions ?? integrationNextActions ?? base.nextActions,
  };
}

export function buildVerifyJson(result: VerifyResult): Record<string, unknown> {
  const suggested = new Set<string>();
  for (const diagnostic of result.diagnostics) {
    for (const command of diagnostic.suggestedCommands ?? []) {
      suggested.add(command);
    }
    if (diagnostic.code === "FORGE_AGENT_STALE_EXPORT") {
      suggested.add("forge agent export --target codex");
      suggested.add("forge agent export --target generic");
    }
  }
  if (result.exitCode === 0) {
    suggested.add("forge inspect summary --json");
  } else {
    suggested.add("forge repair diagnose --from-last-test-run --json");
  }
  const fullSuiteRun = result.steps.some(
    (step) =>
      !step.skipped &&
      (step.name === "tests" ||
        step.name === "tests:testgraph-strict" ||
        step.name === "tests:framework-full"),
  );
  const impactTestsRun = result.steps.some((step) => !step.skipped && step.name === "impact-tests");
  const skippedFullSuite = result.steps.some((step) => step.skipped && step.name === "tests");
  const skippedImpactTests = result.steps.some((step) => step.skipped && step.name === "impact-tests");
  const testCoverageMode = fullSuiteRun
    ? "full"
    : impactTestsRun
      ? "impact"
      : result.steps.some((step) => !step.skipped)
        ? "checks-only"
        : "none";
  const testGraphPlan = result.testGraphPlan
    ? {
        schemaVersion: result.testGraphPlan.schemaVersion,
        fileCount: result.testGraphPlan.fileCount,
        chunkCount: result.testGraphPlan.chunkCount,
        totalJobs: result.testGraphPlan.totalJobs,
        laneMode: result.testGraphPlan.laneMode,
        jobs: result.testGraphPlan.jobs,
        isolatedJobs: result.testGraphPlan.isolatedJobs,
        lanes: result.testGraphPlan.lanes,
        criticalPathEstimateMs: result.testGraphPlan.criticalPathEstimateMs,
        profilePath: result.testGraphPlan.profilePath,
        profileFound: result.testGraphPlan.profileFound,
        slowestFiles: result.testGraphPlan.slowestFiles,
        recommendations: result.testGraphPlan.recommendations,
        chunksIncluded: false,
      }
    : null;
  return {
    schemaVersion: "0.1.0",
    ok: result.ok,
    profile: result.profile ?? null,
    summary: {
      steps: result.steps.length,
      failedSteps: result.steps.filter((step) => !step.ok && !step.skipped).map((step) => step.name),
      skippedSteps: result.steps.filter((step) => step.skipped).map((step) => step.name),
      diagnostics: result.diagnostics.length,
      testCoverage: {
        mode: testCoverageMode,
        fullSuiteRun,
        impactTestsRun,
        skippedImpactTests,
        skippedFullSuite,
        reason: result.testCoverageReason ?? null,
      },
    },
    steps: result.steps,
    diagnostics: result.diagnostics,
    testGraphPlan,
    durationMs: result.durationMs ?? null,
    nextActions: [...suggested],
    exitCode: result.exitCode,
  };
}

export function writeHumanVerify(result: VerifyResult): void {
  if (result.testGraphPlan) {
    const plan = result.testGraphPlan;
    console.log(
      `testgraph plan: ${plan.fileCount} files, ${plan.chunkCount} chunks, ${plan.laneMode} lanes, total jobs ${plan.totalJobs}, parallel jobs ${plan.jobs}, isolated jobs ${plan.isolatedJobs}, estimated ${plan.criticalPathEstimateMs}ms`,
    );
    for (const file of plan.slowestFiles.slice(0, 5)) {
      console.log(`testgraph slow: ${file.file} (${file.lane}, ${file.estimatedMs}ms, ${file.source})`);
    }
    for (const recommendation of plan.recommendations) {
      console.log(`testgraph hint: ${recommendation}`);
    }
  }

  for (const step of result.steps) {
    if (step.skipped) {
      console.log(`skip ${step.name}: ${step.skipReason}`);
      continue;
    }
    const suffix = [
      step.durationMs !== undefined ? `${step.durationMs}ms` : null,
      step.timedOut ? "timed out" : null,
      step.failureKind ? step.failureKind : null,
      step.command ? step.command : null,
    ].filter(Boolean).join(" ");
    console.log(`${step.ok ? "ok" : "fail"} ${step.name}${suffix ? ` (${suffix})` : ""}`);
  }

  for (const diagnostic of result.diagnostics) {
    const location = diagnostic.file ? ` ${diagnostic.file}` : "";
    console.log(
      `${diagnostic.severity} ${diagnostic.code}:${location} ${diagnostic.message}`,
    );
  }
}

export function buildInspectJson(result: InspectResult): Record<string, unknown> {
  const dataNextActions =
    result.data &&
    typeof result.data === "object" &&
    !Array.isArray(result.data) &&
    Array.isArray((result.data as { nextActions?: unknown }).nextActions)
      ? (result.data as { nextActions: unknown[] }).nextActions.filter((action): action is string => typeof action === "string")
      : [];
  return {
    schemaVersion: "0.1.0",
    ok: result.exitCode === 0,
    target: result.target,
    summary:
      result.data && typeof result.data === "object" && !Array.isArray(result.data)
        ? ((result.data as Record<string, unknown>).summary ?? null)
        : null,
    data: result.data,
    warnings: result.warnings,
    errors: result.errors,
    diagnostics: [...result.errors, ...result.warnings],
    nextActions:
      result.exitCode === 0
        ? (dataNextActions.length > 0 ? dataNextActions : ["forge inspect summary --json", "forge check --json"])
        : ["forge generate", `forge inspect ${result.target} --json`],
    exitCode: result.exitCode,
    failureKind: result.failureKind ?? null,
  };
}

export function writeHumanGenerate(result: GenerateResult): void {
  const changed = compactList(result.changed, 20);
  const unchanged = compactList(result.unchanged, 20);
  if (result.exitCode !== 0 && result.errors.length === 0 && result.changed.length > 0) {
    console.error(`generated drift: ${result.changed.length} artifact(s) would change; run forge generate`);
  }
  for (const path of changed.sample) {
    console.log(`changed: ${path}`);
  }
  if (changed.hidden > 0) {
    console.log(`changed: ... ${changed.hidden} more`);
  }
  for (const path of unchanged.sample) {
    console.log(`unchanged: ${path}`);
  }
  if (unchanged.hidden > 0) {
    console.log(`unchanged: ... ${unchanged.hidden} more`);
  }
  const diagnostics = [...result.warnings, ...result.errors];
  const diagnosticSample = diagnostics.slice(0, 20);
  for (const diagnostic of diagnosticSample) {
    console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
  if (diagnostics.length > diagnosticSample.length) {
    console.error(`diagnostics: ... ${diagnostics.length - diagnosticSample.length} more`);
  }
}

export function writeHumanAdd(result: ForgeAddResult): void {
  console.log(`forge add ${result.alias ?? ""}`);
  if (result.targetKind) {
    console.log(`type: ${result.targetKind}`);
  }
  if (result.mode === "package") {
    if (result.packageSpec) {
      console.log(`package spec: ${result.packageSpec}`);
    }
    if (result.packageName && result.packageName !== result.packageSpec) {
      console.log(`package name: ${result.packageName}`);
    }
    if (result.target) {
      console.log(`target: ${result.target}`);
    }
    if (result.packageTarget) {
      console.log(`package target: ${result.packageTarget}`);
    }
    if (result.packageTargetReason) {
      console.log(`target reason: ${result.packageTargetReason}`);
    }
    if (result.installWorkspace) {
      console.log(`install workspace: ${result.installWorkspace}`);
    }
    if (result.installCwd) {
      console.log(`install cwd: ${result.installCwd}`);
    }
    if (result.installCommand) {
      console.log(`install command: ${result.installCommand.join(" ")}`);
    }
    if (result.avoidedManualCommand) {
      console.log(`manual command avoided: ${result.avoidedManualCommand}`);
    }
  }
  if (result.explanation) {
    console.log(result.explanation);
  }
  writeHumanGenerate(result);
  const nextActions = buildAddJson(result).nextActions;
  if (Array.isArray(nextActions) && nextActions.length > 0) {
    console.log("Next:");
    for (const action of nextActions) {
      if (typeof action === "string") {
        console.log(`  ${action}`);
      }
    }
  }
}

export function writeHumanInspect(result: InspectResult): void {
  console.log(JSON.stringify(result.data, null, 2));
  for (const diagnostic of [...result.warnings, ...result.errors]) {
    console.error(`${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`);
  }
}
