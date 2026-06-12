import { nodeFileSystem } from "../compiler/fs/index.ts";
import { join } from "node:path";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { classify } from "../compiler/classifier/classify.ts";
import { buildRuntimeMatrix } from "../compiler/classifier/runtime-matrix.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { checkAiUsageInApp } from "../compiler/guards/check-ai-usage.ts";
import { checkImportGuards } from "../compiler/guards/check-import-guards.ts";
import { checkDirectProcessEnvUsage } from "../compiler/guards/check-process-env.ts";
import { checkQueryUsageInApp } from "../compiler/guards/check-query-usage.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { resetCompileSessions } from "../compiler/orchestrator/session.ts";
import { discover } from "../compiler/orchestrator/discover.ts";
import { loadManifest } from "../compiler/orchestrator/manifest.ts";
import { PackageGraphCompiler } from "../compiler/package-graph/compiler.ts";
import { resolveByPackageName } from "../compiler/recipes/registry.ts";
import type { AppGraph } from "../compiler/types/app-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { FrontendGraph } from "../compiler/types/frontend-graph.ts";
import type { RuntimeMatrix } from "../compiler/types/runtime-matrix.ts";
import { runImpactCommand } from "../impact/index.ts";
import type { TestRunRecord } from "../impact/types.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import type { UiRunReport } from "../ui/types.ts";
import type {
  DevConsoleCycle,
  DevConsoleNextAction,
  DevConsoleOptions,
  DevConsolePhase,
  FrontendSummary,
  ImpactSummary,
  LastTestRunSummary,
  LastUiRunSummary,
} from "./types.ts";

function msSince(start: number): number {
  return Math.max(0, Math.round(performance.now() - start));
}

function readJson<T>(workspaceRoot: string, relativePath: string): T | null {
  const absolute = join(workspaceRoot, relativePath);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(stripDeterministicHeader((nodeFileSystem.readText(absolute) ?? ""))) as T;
  } catch {
    return null;
  }
}

async function loadRuntimeMatrixForDevConsole(workspaceRoot: string): Promise<RuntimeMatrix> {
  const generated = readJson<RuntimeMatrix>(workspaceRoot, `${GENERATED_DIR}/runtimeMatrix.json`);
  if (generated) {
    return generated;
  }

  const ctx = discover({ workspaceRoot });
  const compiler = new PackageGraphCompiler();
  const classified = await Promise.all(
    ctx.dependencies.map(async (dep) => {
      const recipe = resolveByPackageName(dep.name) ?? undefined;
      const api = await compiler.analyze(dep, {
        runtimeInspect: false,
        resolutionMode: "nodenext",
        cacheDir: ctx.cacheDir,
        recipeVersion: recipe?.recipeVersion,
      });
      return {
        api,
        classification: classify(api, recipe),
        recipe,
      };
    }),
  );

  return buildRuntimeMatrix(classified);
}

function phase(
  name: DevConsolePhase["name"],
  diagnostics: Diagnostic[],
  durationMs: number,
  details?: Record<string, unknown>,
  message?: string,
): DevConsolePhase {
  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  const hasWarnings = diagnostics.some((diagnostic) => diagnostic.severity === "warning");
  return {
    name,
    ok: !hasErrors,
    status: hasErrors ? "failed" : hasWarnings ? "warning" : "ok",
    ...(message ? { message } : {}),
    diagnostics,
    durationMs,
    ...(details ? { details } : {}),
  };
}

function skippedPhase(
  name: DevConsolePhase["name"],
  message: string,
  durationMs = 0,
): DevConsolePhase {
  return {
    name,
    ok: true,
    status: "skipped",
    message,
    diagnostics: [],
    durationMs,
  };
}

async function runGeneratedPhase(workspaceRoot: string): Promise<DevConsolePhase> {
  const start = performance.now();
  const result = await runGenerate({
    workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  const diagnostics = [...result.errors, ...result.warnings];
  const durationMs = msSince(start);
  return {
    name: "generated",
    ok: result.exitCode === 0,
    status: result.exitCode === 0 ? (diagnostics.some((diag) => diag.severity === "warning") ? "warning" : "ok") : "failed",
    diagnostics,
    durationMs,
    details: {
      changed: result.changed,
      unchangedCount: result.unchanged.length,
    },
    message: result.exitCode === 0 ? "generated artifacts are up to date" : "generated artifacts are stale",
  };
}

async function buildAppGraphForDevConsole(workspaceRoot: string): Promise<AppGraph> {
  const ctx = discover({ workspaceRoot });
  const manifest = loadManifest(ctx.cacheDir);
  return buildAppGraph({
    workspaceRoot: ctx.workspaceRoot,
    sources: ctx.sources,
    prior: manifest.priorAppGraph,
    tsconfigPath: ctx.tsconfigPath ?? undefined,
  });
}

function loadGeneratedAppGraphForDevConsole(workspaceRoot: string): AppGraph | null {
  return readJson<AppGraph>(workspaceRoot, `${GENERATED_DIR}/appGraph.json`);
}

async function runCheckPhase(workspaceRoot: string, strictSecrets: boolean): Promise<DevConsolePhase> {
  const start = performance.now();
  const appGraph =
    loadGeneratedAppGraphForDevConsole(workspaceRoot) ??
    (await buildAppGraphForDevConsole(workspaceRoot));
  const matrix = await loadRuntimeMatrixForDevConsole(workspaceRoot);
  const secretRegistry = loadSecretRegistry(workspaceRoot);
  const diagnostics = [
    ...checkImportGuards(appGraph.moduleGraph, matrix),
    ...checkDirectProcessEnvUsage(workspaceRoot, secretRegistry, strictSecrets),
    ...checkAiUsageInApp(appGraph),
    ...checkQueryUsageInApp(appGraph),
  ];
  return phase("check", diagnostics, msSince(start), undefined, diagnostics.some((diag) => diag.severity === "error") ? "checks failed" : "checks passed");
}

function requiredGeneratedArtifacts(workspaceRoot: string): Array<{ name: string; path: string; ok: boolean }> {
  return [
    { name: "agents-md", path: "AGENTS.md", ok: nodeFileSystem.exists(join(workspaceRoot, "AGENTS.md")) },
    { name: "forge-lock", path: "forge.lock", ok: nodeFileSystem.exists(join(workspaceRoot, "forge.lock")) },
    { name: "agent-contract", path: `${GENERATED_DIR}/agentContract.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "agentContract.json")) },
    { name: "runtime-matrix", path: `${GENERATED_DIR}/runtimeMatrix.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "runtimeMatrix.json")) },
    { name: "data-graph", path: `${GENERATED_DIR}/dataGraph.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "dataGraph.json")) },
    { name: "policies", path: `${GENERATED_DIR}/policyRegistry.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "policyRegistry.json")) },
    { name: "client", path: `${GENERATED_DIR}/clientManifest.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "clientManifest.json")) },
    { name: "frontend", path: `${GENERATED_DIR}/frontendGraph.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "frontendGraph.json")) },
    { name: "ui", path: `${GENERATED_DIR}/uiTestManifest.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "uiTestManifest.json")) },
  ];
}

function runDoctorPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const artifacts = requiredGeneratedArtifacts(workspaceRoot);
  const diagnostics = artifacts
    .filter((artifact) => !artifact.ok)
    .map((artifact) =>
      createDiagnostic({
        severity: "error",
        code: "FORGE_DEV_DOCTOR_MISSING_ARTIFACT",
        message: `missing ${artifact.path}`,
        file: artifact.path,
        fixHint: "Run forge generate and inspect the generated artifact list again.",
        suggestedCommands: ["forge generate", "forge dev --once --json"],
        docs: ["AGENTS.md"],
      }),
    );
  return phase("doctor", diagnostics, msSince(start), { artifacts }, diagnostics.length === 0 ? "project shape looks coherent" : "project is missing required artifacts");
}

function runFrontendPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const frontend = readJson<FrontendGraph>(workspaceRoot, `${GENERATED_DIR}/frontendGraph.json`);
  if (!frontend) {
    return {
      name: "frontend",
      ok: true,
      status: "skipped",
      message: "no generated frontend graph found",
      diagnostics: [],
      durationMs: msSince(start),
    };
  }

  const summary: FrontendSummary = {
    present: frontend.present,
    framework: frontend.framework,
    routes: frontend.routes.map((route) => route.path),
    bindings: [...new Set(frontend.clientBindings.map((binding) => `${binding.kind}:${binding.name}`))].sort(),
    bridgeFiles: frontend.bridgeFiles,
    ...(frontend.dev ? { devUrl: frontend.dev.url, apiUrlEnv: frontend.dev.apiUrlEnv } : {}),
  };
  const diagnostics = frontend.diagnostics ?? [];
  const message = frontend.present
    ? `frontend ${frontend.framework} with ${frontend.routes.length} routes and ${frontend.clientBindings.length} bindings`
    : "no frontend app detected";
  return phase("frontend", diagnostics, msSince(start), { summary }, message);
}

function runImpactPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const result = runImpactCommand({
    workspaceRoot,
    json: true,
    write: false,
    changed: true,
    staged: false,
    includeGenerated: false,
    excludeTests: false,
  });
  const gitUnavailable = result.diagnostics.some(
    (diagnostic) => diagnostic.code === "FORGE_IMPACT_GIT_UNAVAILABLE",
  );
  if (gitUnavailable) {
    return skippedPhase(
      "impact",
      "impact skipped because workspace is not a git repository",
      msSince(start),
    );
  }
  const report = result.report;
  const summary: ImpactSummary | undefined = report
    ? {
      changedFiles: report.changedFiles,
      risk: report.risk.level,
      recommendedChecks: report.recommendedChecks,
    }
    : undefined;
  return phase(
    "impact",
    result.diagnostics,
    msSince(start),
    summary ? { summary } : undefined,
    summary && summary.changedFiles.length > 0 ? `${summary.changedFiles.length} changed files detected` : "no changed files detected",
  );
}

function runLastTestPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const record = readJson<TestRunRecord>(workspaceRoot, ".forge/test-runs/last.json");
  if (!record) {
    return {
      name: "last-test-run",
      ok: true,
      status: "skipped",
      message: "no last test run report found",
      diagnostics: [],
      durationMs: msSince(start),
    };
  }
  const summary: LastTestRunSummary = {
    id: record.id,
    ok: record.failed.length === 0,
    failed: record.failed,
    durationMs: record.durationMs,
  };
  const diagnostics = record.failed.length > 0
    ? [
      createDiagnostic({
        severity: "error",
        code: "FORGE_TEST_RUN_FAILED",
        message: "last impact test run has failures",
        file: ".forge/test-runs/last.json",
        fixHint: "Diagnose the last test run and apply only high-confidence repair plans.",
        suggestedCommands: ["forge repair diagnose --from-last-test-run --json", "forge test run --changed --json"],
      }),
    ]
    : [];
  return phase("last-test-run", diagnostics, msSince(start), { summary }, summary.ok ? "last test run passed" : "last test run failed");
}

function runLastUiPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const report = readJson<UiRunReport>(workspaceRoot, ".forge/ui-runs/last.json");
  if (!report) {
    return {
      name: "last-ui-run",
      ok: true,
      status: "skipped",
      message: "no last UI run report found",
      diagnostics: [],
      durationMs: msSince(start),
    };
  }
  const failedScenarios = report.scenarios
    .filter((scenario) => !scenario.ok)
    .map((scenario) => scenario.name);
  const summary: LastUiRunSummary = {
    id: report.id,
    ok: failedScenarios.length === 0 && report.diagnostics.every((diag) => diag.severity !== "error"),
    failedScenarios,
  };
  const diagnostics = summary.ok
    ? report.diagnostics
    : [
      ...report.diagnostics,
      createDiagnostic({
        severity: "error",
        code: "FORGE_UI_RUN_FAILED",
        message: "last UI run has failures",
        file: ".forge/ui-runs/last.json",
        fixHint: "Inspect the UI report and feed it into the repair loop.",
        suggestedCommands: ["forge ui report last --json", "forge repair diagnose --from-last-ui-run --json"],
      }),
    ];
  return phase("last-ui-run", diagnostics, msSince(start), { summary }, summary.ok ? "last UI run passed" : "last UI run failed");
}

function uniqueActions(actions: DevConsoleNextAction[]): DevConsoleNextAction[] {
  const seen = new Set<string>();
  const result: DevConsoleNextAction[] = [];
  for (const action of actions) {
    if (seen.has(action.command)) {
      continue;
    }
    seen.add(action.command);
    result.push(action);
  }
  return result;
}

function nextActionsFromPhases(phases: DevConsolePhase[]): DevConsoleNextAction[] {
  const actions: DevConsoleNextAction[] = [];
  const generated = phases.find((item) => item.name === "generated");
  if (generated && !generated.ok) {
    actions.push({
      command: "forge generate",
      reason: "generated artifacts are stale",
      confidence: "high",
    });
  }

  for (const diagnostic of phases.flatMap((item) => item.diagnostics)) {
    for (const command of diagnostic.suggestedCommands ?? []) {
      actions.push({
        command,
        reason: `${diagnostic.code}: ${diagnostic.fixHint ?? diagnostic.message}`,
        confidence: diagnostic.severity === "error" ? "high" : "medium",
      });
    }
  }

  const impact = phases.find((item) => item.name === "impact");
  const summary = impact?.details?.summary as ImpactSummary | undefined;
  if (summary && summary.changedFiles.length > 0) {
    actions.push({
      command: "forge test plan --changed --json",
      reason: "changed files were detected; plan targeted checks",
      confidence: "high",
    });
    actions.push({
      command: "forge verify --changed",
      reason: "run the focused verification gate for changed files",
      confidence: "medium",
    });
  }

  if (actions.length === 0) {
    actions.push({
      command: "forge dev --watch",
      reason: "project diagnostics are clean; keep the dev console watching for changes",
      confidence: "medium",
    });
  }

  return uniqueActions(actions).slice(0, 12);
}

export async function runDevConsoleCycle(options: DevConsoleOptions): Promise<DevConsoleCycle> {
  resetCompileSessions();
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const phases: DevConsolePhase[] = [];
  const generated = await runGeneratedPhase(workspaceRoot);
  phases.push(generated);
  if (generated.ok) {
    phases.push(await runCheckPhase(workspaceRoot, options.strictSecrets ?? false));
    phases.push(runFrontendPhase(workspaceRoot));
  } else {
    phases.push(
      skippedPhase(
        "check",
        "skipped until generated artifacts are in sync",
      ),
    );
    phases.push(
      skippedPhase(
        "frontend",
        "skipped until generated frontend graph is in sync",
      ),
    );
  }
  phases.push(runDoctorPhase(workspaceRoot));
  if (options.includeImpact ?? true) {
    phases.push(runImpactPhase(workspaceRoot));
  }
  phases.push(runLastTestPhase(workspaceRoot));
  phases.push(runLastUiPhase(workspaceRoot));

  const diagnostics = phases.flatMap((item) => item.diagnostics);
  const ok = phases.every((item) => item.ok);
  return {
    schemaVersion: "0.1.0",
    ok,
    mode: options.mode,
    phases,
    diagnostics,
    nextActions: nextActionsFromPhases(phases),
    exitCode: ok ? 0 : 1,
  };
}

export function formatDevConsoleJson(cycle: DevConsoleCycle): string {
  return `${JSON.stringify(cycle, null, 2)}\n`;
}

export function formatDevConsoleHuman(cycle: DevConsoleCycle): string {
  const lines = ["Forge Dev Console", ""];
  for (const phaseItem of cycle.phases) {
    const marker = phaseItem.status === "ok" ? "OK" : phaseItem.status === "warning" ? "WARN" : phaseItem.status === "skipped" ? "SKIP" : "FAIL";
    lines.push(`${marker} ${phaseItem.name}${phaseItem.message ? ` - ${phaseItem.message}` : ""}`);
    for (const diagnostic of phaseItem.diagnostics.filter((diag) => diag.severity === "error").slice(0, 3)) {
      lines.push(`  ${diagnostic.code}: ${diagnostic.message}`);
      if (diagnostic.fixHint) {
        lines.push(`  Fix: ${diagnostic.fixHint}`);
      }
    }
    if (phaseItem.name === "frontend") {
      const summary = phaseItem.details?.summary as FrontendSummary | undefined;
      if (summary?.present) {
        lines.push(`  URL: ${summary.devUrl ?? "unknown"}`);
        lines.push(`  Bridge: ${summary.bridgeFiles.length > 0 ? summary.bridgeFiles.join(", ") : "missing"}`);
        lines.push(`  Bindings: ${summary.bindings.length}`);
      }
    }
  }
  lines.push("");
  lines.push("Next actions:");
  for (const action of cycle.nextActions.slice(0, 5)) {
    lines.push(`  ${action.command}`);
    lines.push(`    ${action.reason}`);
  }
  lines.push("");
  lines.push(cycle.ok ? "Dev diagnostics are clean." : "Dev diagnostics need attention.");
  return `${lines.join("\n")}\n`;
}
