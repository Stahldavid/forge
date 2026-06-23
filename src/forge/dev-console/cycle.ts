import { nodeFileSystem } from "../compiler/fs/index.ts";
import { basename, join } from "node:path";
import { buildAppGraph } from "../compiler/app-graph/build.ts";
import { classify } from "../compiler/classifier/classify.ts";
import { buildRuntimeMatrix } from "../compiler/classifier/runtime-matrix.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { TableMapEntry } from "../compiler/data-graph/sql/serialize.ts";
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
import type { AgentCapabilityMap } from "../compiler/agent-contract/types.ts";
import type { RuntimeMatrix } from "../compiler/types/runtime-matrix.ts";
import { runImpactCommand } from "../impact/index.ts";
import type { TestRunRecord } from "../impact/types.ts";
import { loadSecretRegistry } from "../runtime/secrets/check.ts";
import type { UiRunReport } from "../ui/types.ts";
import { buildDiffPlanFromChangeSummary, categorizeFiles, summarizeChangeTypes } from "../workspace/change-summary.ts";
import type {
  DevConsoleCycle,
  DevConsoleAgentContext,
  DevConsoleGeneratedSummary,
  DevConsoleNextAction,
  DevConsoleOptions,
  DevConsolePhase,
  DevConsoleSummary,
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

function compactFileList(files: string[], sampleSize = 12): {
  count: number;
  sample: string[];
  hidden: number;
} {
  return {
    count: files.length,
    sample: files.slice(0, sampleSize),
    hidden: Math.max(0, files.length - sampleSize),
  };
}

async function runGeneratedPhase(workspaceRoot: string): Promise<DevConsolePhase> {
  const start = performance.now();
  const result = await runGenerate({
    workspaceRoot,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  const diagnostics = [...result.errors, ...result.warnings];
  const durationMs = msSince(start);
  const changed = compactFileList(result.changed);
  return {
    name: "generated",
    ok: result.exitCode === 0,
    status: result.exitCode === 0 ? (diagnostics.some((diag) => diag.severity === "warning") ? "warning" : "ok") : "failed",
    diagnostics,
    durationMs,
    details: {
      changed: changed.count,
      sampleChanged: changed.sample,
      hiddenChanged: changed.hidden,
      unchangedCount: result.unchanged.length,
      fullCommand: "forge generate --json",
      ...(result.cache ? { cache: result.cache } : {}),
    },
    message: result.exitCode === 0
      ? result.changed.length > 0
        ? `regenerated ${result.changed.length} generated artifacts`
        : "generated artifacts are up to date"
      : "generated artifacts could not be regenerated",
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
    { name: "agent-quickstart", path: `${GENERATED_DIR}/agentQuickstart.md`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "agentQuickstart.md")) },
    { name: "agent-cair-guide", path: `${GENERATED_DIR}/agentCairGuide.md`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "agentCairGuide.md")) },
    { name: "capability-map", path: `${GENERATED_DIR}/capabilityMap.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "capabilityMap.json")) },
    { name: "runtime-matrix", path: `${GENERATED_DIR}/runtimeMatrix.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "runtimeMatrix.json")) },
    { name: "data-graph", path: `${GENERATED_DIR}/dataGraph.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "dataGraph.json")) },
    { name: "policies", path: `${GENERATED_DIR}/policyRegistry.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "policyRegistry.json")) },
    { name: "client", path: `${GENERATED_DIR}/clientManifest.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "clientManifest.json")) },
    { name: "frontend", path: `${GENERATED_DIR}/frontendGraph.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "frontendGraph.json")) },
    { name: "ui", path: `${GENERATED_DIR}/uiTestManifest.json`, ok: nodeFileSystem.exists(join(workspaceRoot, GENERATED_DIR, "uiTestManifest.json")) },
  ];
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function hasUuidTenantColumns(tableMap: Record<string, TableMapEntry>): boolean {
  return Object.values(tableMap).some((entry) => {
    if (!entry.tenantScoped || !entry.tenantIdColumn) {
      return false;
    }
    return entry.columns.some(
      (column) => column.name === entry.tenantIdColumn && column.sqlType === "uuid",
    );
  });
}

function runDoctorPhase(workspaceRoot: string): DevConsolePhase {
  const start = performance.now();
  const artifacts = requiredGeneratedArtifacts(workspaceRoot);
  const diagnostics: Diagnostic[] = artifacts
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
  const frontend = readJson<FrontendGraph>(workspaceRoot, `${GENERATED_DIR}/frontendGraph.json`);
  diagnostics.push(...(frontend?.diagnostics ?? []));
  const capabilityMap = readJson<{ diagnostics?: Diagnostic[] }>(
    workspaceRoot,
    `${GENERATED_DIR}/capabilityMap.json`,
  );
  diagnostics.push(...(capabilityMap?.diagnostics ?? []));
  const dbJson = readJson<{ tableMap: Record<string, TableMapEntry> }>(
    workspaceRoot,
    `${GENERATED_DIR}/db.json`,
  );
  if (frontend && hasUuidTenantColumns(dbJson?.tableMap ?? {})) {
    for (const provider of frontend.providers) {
      if (provider.devAuthTenantId && !isUuidLike(provider.devAuthTenantId)) {
        diagnostics.push(createDiagnostic({
          severity: "warning",
          code: "FORGE_FRONTEND_DEV_AUTH_TENANT_MISMATCH",
          message: `${provider.file} devAuth tenantId '${provider.devAuthTenantId}' is not UUID-like, but tenant tables use uuid tenant ids`,
          file: provider.file,
          fixHint: "Use a UUID-like local tenant id in ForgeProvider devAuth, or seed a matching tenant row for local development.",
          suggestedCommands: ["forge inspect frontend --json", "forge dev --once --json"],
          docs: ["src/forge/_generated/frontendGraph.json", "AGENTS.md"],
        }));
      }
    }
  }
  const missingArtifacts = artifacts.some((artifact) => !artifact.ok);
  return phase(
    "doctor",
    diagnostics,
    msSince(start),
    { artifacts },
    diagnostics.length === 0
      ? "project shape looks coherent"
      : missingArtifacts
        ? "project is missing required artifacts"
        : "project has frontend/runtime warnings",
  );
}

function withRuntimeFrontendUrls(
  summary: FrontendSummary,
  options: { apiUrl?: string; webUrl?: string },
): FrontendSummary {
  return {
    ...summary,
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.webUrl ? { devUrl: options.webUrl } : {}),
  };
}

function runFrontendPhase(
  workspaceRoot: string,
  options: { apiUrl?: string; webUrl?: string } = {},
): DevConsolePhase {
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

  const summary: FrontendSummary = withRuntimeFrontendUrls({
    present: frontend.present,
    framework: frontend.framework,
    routes: frontend.routes.map((route) => route.path),
    bindings: [...new Set(frontend.clientBindings.map((binding) => `${binding.kind}:${binding.name}`))].sort(),
    bridgeFiles: frontend.bridgeFiles,
    apiUrl: frontend.webManifest.urls.api,
    ...(frontend.dev ? { devUrl: frontend.dev.url, apiUrlEnv: frontend.dev.apiUrlEnv } : {}),
  }, options);
  const diagnostics = frontend.diagnostics ?? [];
  const message = frontend.present
    ? `frontend ${frontend.framework} with ${frontend.routes.length} routes and ${frontend.clientBindings.length} bindings`
    : "no frontend app detected";
  return phase("frontend", diagnostics, msSince(start), { summary }, message);
}

function defaultFrontendSummary(workspaceRoot: string): FrontendSummary {
  const frontend = readJson<FrontendGraph>(workspaceRoot, `${GENERATED_DIR}/frontendGraph.json`);
  return {
    present: frontend?.present ?? false,
    framework: frontend?.framework ?? "none",
    routes: frontend?.routes.map((route) => route.path) ?? [],
    bindings: frontend
      ? [...new Set(frontend.clientBindings.map((binding) => `${binding.kind}:${binding.name}`))].sort()
      : [],
    bridgeFiles: frontend?.bridgeFiles ?? [],
    apiUrl: frontend?.webManifest.urls.api ?? "http://127.0.0.1:3765",
    ...(frontend?.dev ? { devUrl: frontend.dev.url, apiUrlEnv: frontend.dev.apiUrlEnv } : {}),
  };
}

function nextPreviewPort(webUrl?: string): number {
  if (!webUrl) {
    return 5174;
  }
  try {
    const parsed = new URL(webUrl);
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return Number.isFinite(port) && port > 0 ? port + 1 : 5174;
  } catch {
    return 5174;
  }
}

function isForgeStudioWorkspace(workspaceRoot: string): boolean {
  return basename(workspaceRoot).toLowerCase() === "forge-studio";
}

function previewSummaryFor(input: {
  workspaceRoot: string;
  webUrl?: string;
}): DevConsoleSummary["preview"] {
  if (input.webUrl && !isForgeStudioWorkspace(input.workspaceRoot)) {
    const parsed = new URL(input.webUrl);
    const targetAppPort = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return {
      targetAppUrl: input.webUrl,
      targetAppPort,
      isStudioSelfPreview: false,
      note: `Web app preview is running at ${input.webUrl}.`,
    };
  }

  const targetAppPort = nextPreviewPort(input.webUrl);
  const targetAppUrl = `http://127.0.0.1:${targetAppPort}`;
  const isStudioSelfPreview = Boolean(input.webUrl && input.webUrl === targetAppUrl);
  return {
    ...(input.webUrl ? { studioUrl: input.webUrl } : {}),
    targetAppUrl,
    targetAppPort,
    isStudioSelfPreview,
    note: input.webUrl
      ? `Use ${targetAppUrl} for the app being built when ${input.webUrl} is Forge Studio itself.`
      : `No web app was detected; ${targetAppUrl} is the default target app preview URL for Studio attach flows.`,
  };
}

function buildGeneratedSummary(phaseItem: DevConsolePhase | undefined): DevConsoleGeneratedSummary {
  const changedFiles = Number(phaseItem?.details?.changed ?? 0);
  const sampleChanged = Array.isArray(phaseItem?.details?.sampleChanged)
    ? phaseItem.details.sampleChanged.filter((item): item is string => typeof item === "string")
    : [];
  const hiddenChanged = Number(phaseItem?.details?.hiddenChanged ?? 0);
  return {
    ok: phaseItem?.ok === true,
    state: phaseItem?.ok === true
      ? changedFiles > 0 ? "regenerated" : "fresh"
      : "stale-risk",
    changedFiles,
    sampleChanged,
    hiddenChanged,
    message: phaseItem?.message ?? "generated phase did not report a message",
    command: "forge generate",
    checkCommand: "forge generate --check --json",
  };
}

function buildDevSummary(input: {
  workspaceRoot: string;
  ok: boolean;
  phases: DevConsolePhase[];
  diagnostics: Diagnostic[];
  nextActions: DevConsoleNextAction[];
  apiUrl?: string;
  webUrl?: string;
}): DevConsoleSummary {
  const frontendPhase = input.phases.find((item) => item.name === "frontend");
  const frontendBase =
    (frontendPhase?.details?.summary as FrontendSummary | undefined) ??
    defaultFrontendSummary(input.workspaceRoot);
  const frontend = withRuntimeFrontendUrls(frontendBase, {
    ...(input.apiUrl ? { apiUrl: input.apiUrl } : {}),
    ...(input.webUrl ? { webUrl: input.webUrl } : {}),
  });
  const capabilityMap = readJson<AgentCapabilityMap>(
    input.workspaceRoot,
    `${GENERATED_DIR}/capabilityMap.json`,
  );
  const warnings = input.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").length;
  const errors = input.diagnostics.filter((diagnostic) => diagnostic.severity === "error").length;
  const apiUrl = input.apiUrl ?? frontend.apiUrl ?? "http://127.0.0.1:3765";
  const webUrl = input.webUrl ?? frontend.devUrl;
  const generated = buildGeneratedSummary(input.phases.find((item) => item.name === "generated"));
  const preview = previewSummaryFor({
    workspaceRoot: input.workspaceRoot,
    ...(webUrl ? { webUrl } : {}),
  });
  return {
    project: {
      root: input.workspaceRoot,
    },
    health: {
      ok: input.ok,
      errors,
      warnings,
      skipped: input.phases.filter((item) => item.status === "skipped").length,
    },
    urls: {
      api: apiUrl,
      ...(webUrl ? { web: webUrl } : {}),
      suggestedPreview: preview.targetAppUrl,
    },
    preview,
    generated,
    frontend,
    capabilities: capabilityMap?.summary ?? {
      covered: 0,
      backendOnly: 0,
      frontendOnly: 0,
      warnings: 0,
    },
    agentContext: buildAgentContext({
      phases: input.phases,
      diagnostics: input.diagnostics,
      nextActions: input.nextActions,
    }),
    ...(input.nextActions[0] ? { primaryAction: input.nextActions[0] } : {}),
  };
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
    ? (() => {
      const changeSummary = categorizeFiles(report.changedFiles);
      return {
        changedFiles: report.changedFiles.length,
        sampleChangedFiles: report.changedFiles.slice(0, 12),
        hiddenChangedFiles: Math.max(0, report.changedFiles.length - 12),
        changeSummary,
        risk: report.risk.level,
        recommendedChecks: report.recommendedChecks,
        fullCommand: "forge impact --changed --json",
      };
    })()
    : undefined;
  const changeTypes = summary ? summarizeChangeTypes(summary.changeSummary) : "";
  return phase(
    "impact",
    result.diagnostics,
    msSince(start),
    summary ? { summary } : undefined,
    summary && summary.changedFiles > 0
      ? `${summary.changedFiles} changed files detected${changeTypes ? `: ${changeTypes}` : ""}`
      : "no changed files detected",
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
  const diagnostics = phases.flatMap((item) => item.diagnostics);
  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    actions.push({
      command: "forge do fix --json",
      reason: "centralize the repair path before choosing lower-level commands",
      confidence: "high",
    });
  }
  if (diagnostics.some((diagnostic) => diagnostic.code.startsWith("FORGE_FRONTEND_"))) {
    actions.push({
      command: "forge do connect-ui --json",
      reason: "frontend diagnostics are present; inspect bridge/routes/hooks as one workflow",
      confidence: "high",
    });
  }
  const generated = phases.find((item) => item.name === "generated");
  if (generated && !generated.ok) {
    actions.push({
      command: "forge do fix --json",
      reason: "generated artifacts are stale; use the guided repair path before lower-level commands",
      confidence: "high",
    });
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
  if (summary && summary.changedFiles > 0) {
    actions.push({
      command: "forge changed --json",
      reason: "changed files were detected; inspect grouped human and generated changes first",
      confidence: "high",
    });
    actions.push({
      command: "forge do verify --json",
      reason: "changed files were detected; use the guided verification path",
      confidence: "high",
    });
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
      command: "forge dev",
      reason: "project diagnostics are clean; keep the dev console watching for changes",
      confidence: "medium",
    });
  }

  return uniqueActions(actions).slice(0, 12);
}

function phaseDetails<T>(phases: DevConsolePhase[], name: DevConsolePhase["name"], key: string): T | undefined {
  return phases.find((item) => item.name === name)?.details?.[key] as T | undefined;
}

function buildAgentContext(input: {
  phases: DevConsolePhase[];
  diagnostics: Diagnostic[];
  nextActions: DevConsoleNextAction[];
}): DevConsoleAgentContext {
  const generated = input.phases.find((item) => item.name === "generated");
  const frontend = phaseDetails<FrontendSummary>(input.phases, "frontend", "summary");
  const impact = phaseDetails<ImpactSummary>(input.phases, "impact", "summary");
  const errorDiagnostics = input.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const warningDiagnostics = input.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");
  const generatedChangedFiles = Number(generated?.details?.changed ?? 0);
  const suggestedReadFiles = [
    "AGENTS.md",
    "src/forge/_generated/agentContract.json",
    "src/forge/_generated/appMap.md",
    "src/forge/_generated/runtimeRules.md",
    "src/forge/_generated/operationPlaybooks.md",
    ...(frontend?.present ? ["src/forge/_generated/frontendGraph.json"] : []),
    ...input.diagnostics.flatMap((diagnostic) => diagnostic.docs ?? []),
    ...input.diagnostics.flatMap((diagnostic) => diagnostic.file ? [diagnostic.file] : []),
  ];
  const fullCommands = [
    "forge inspect all --full --json",
    "forge changed --json",
    "forge impact --changed --json",
    "forge generate --json",
  ];
  return {
    safeToEdit: generated?.ok === true && errorDiagnostics.length === 0,
    generatedFresh: generated?.ok === true,
    generatedChanged: generatedChangedFiles > 0,
    generatedChangedFiles,
    frontendReady: frontend?.present ? frontend.bridgeFiles.length > 0 : false,
    changedFiles: impact?.changedFiles ?? 0,
    ...(impact?.changeSummary ? { changeSummary: impact.changeSummary } : {}),
    ...(impact?.changeSummary ? { diffPlan: buildDiffPlanFromChangeSummary(impact.changeSummary) } : {}),
    blockingIssues: errorDiagnostics.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).slice(0, 8),
    recommendedReadFiles: [...new Set(suggestedReadFiles)].slice(0, 12),
    recommendedCommands: input.nextActions.map((action) => action.command).slice(0, 8),
    useFullCommands: warningDiagnostics.length > 0 || (impact?.hiddenChangedFiles ?? 0) > 0
      ? fullCommands
      : fullCommands.slice(0, 1),
  };
}

export async function runDevConsoleCycle(options: DevConsoleOptions): Promise<DevConsoleCycle> {
  resetCompileSessions();
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const phases: DevConsolePhase[] = [];
  const generated = await runGeneratedPhase(workspaceRoot);
  phases.push(generated);
  if (generated.ok) {
    phases.push(await runCheckPhase(workspaceRoot, options.strictSecrets ?? false));
    phases.push(runFrontendPhase(workspaceRoot, {
      ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
      ...(options.webUrl ? { webUrl: options.webUrl } : {}),
    }));
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
  const nextActions = nextActionsFromPhases(phases);
  const summary = buildDevSummary({
    workspaceRoot,
    ok,
    phases,
    diagnostics,
    nextActions,
    ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
    ...(options.webUrl ? { webUrl: options.webUrl } : {}),
  });
  return {
    schemaVersion: "0.1.0",
    ok,
    mode: options.mode,
    summary,
    phases,
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export function formatDevConsoleJson(cycle: DevConsoleCycle): string {
  return `${JSON.stringify(cycle, null, 2)}\n`;
}

export function formatDevConsoleHuman(cycle: DevConsoleCycle): string {
  const lines = ["Forge Dev Console", ""];
  lines.push(cycle.ok ? "Status: OK" : "Status: Needs attention");
  lines.push(`Project: ${cycle.summary.project.root}`);
  lines.push(`API: ${cycle.summary.urls.api}`);
  lines.push(`Web: ${cycle.summary.urls.web ?? "none detected"}`);
  lines.push(`Target preview: ${cycle.summary.preview.targetAppUrl}`);
  lines.push(
    `Generated: ${cycle.summary.generated.state}` +
      (cycle.summary.generated.changedFiles > 0 ? ` (${cycle.summary.generated.changedFiles} changed)` : ""),
  );
  if (cycle.summary.agentContext.diffPlan) {
    lines.push(`Diff focus: ${cycle.summary.agentContext.diffPlan.summary}`);
  }
  if (cycle.summary.preview.isStudioSelfPreview) {
    lines.push("Preview warning: target preview points at the Studio URL");
  }
  lines.push(
    `Frontend: ${cycle.summary.frontend.present ? cycle.summary.frontend.framework : "none"} ` +
      `(${cycle.summary.frontend.routes.length} routes, ${cycle.summary.frontend.bindings.length} bindings)`,
  );
  lines.push(
    `Capabilities: ${cycle.summary.capabilities.covered} covered, ` +
      `${cycle.summary.capabilities.backendOnly} backend-only, ` +
      `${cycle.summary.capabilities.frontendOnly} frontend-only, ` +
      `${cycle.summary.capabilities.warnings} warnings`,
  );
  lines.push(
    `Diagnostics: ${cycle.summary.health.errors} errors, ${cycle.summary.health.warnings} warnings, ${cycle.summary.health.skipped} skipped`,
  );
  if (cycle.summary.primaryAction) {
    lines.push(`Next: ${cycle.summary.primaryAction.command}`);
    lines.push(`  ${cycle.summary.primaryAction.reason}`);
  }
  lines.push("");
  lines.push("Phases");
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
