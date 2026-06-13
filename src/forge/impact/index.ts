import { dirname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson, serializeCanonical } from "../compiler/primitives/serialize.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { AppGraph } from "../compiler/types/app-graph.ts";
import type { DataGraph } from "../compiler/types/data-graph.ts";
import type { PackageGraph } from "../compiler/types/package-graph.ts";
import type { PolicyRegistry } from "../compiler/types/policy-registry.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import type { QueryRegistry } from "../compiler/types/query-registry.ts";
import type { LiveQueryRegistry } from "../compiler/types/live-query-registry.ts";
import type { WorkflowRegistry, WorkflowSubscriptions } from "../compiler/types/workflow-registry.ts";
import type { ActionSubscriptions } from "../compiler/types/action-subscriptions.ts";
import type { TestCost, TestGraph } from "../compiler/types/test-graph.ts";
import { resolveBunExecutable } from "../cli/bun-exec.ts";
import type {
  ImpactCommandOptions,
  ImpactReport,
  ImpactRisk,
  ImpactSource,
  ImpactedSystems,
  ImpactResult,
  ImpactTestPlan,
  TargetedTest,
  TestCommandOptions,
  TestPlanCheck,
  TestRunRecord,
  TestRunStep,
} from "./types.ts";

const GENERATED = "src/forge/_generated";
const TEST_PLAN_DIR = ".forge/test-plans";
const TEST_RUN_DIR = ".forge/test-runs";
const COST_ORDER: TestCost[] = ["instant", "fast", "standard", "slow", "docker", "browser"];

function diag(severity: Diagnostic["severity"], code: string, message: string, file?: string): Diagnostic {
  return createDiagnostic({ severity, code, message, ...(file ? { file } : {}) });
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function readJson<T>(workspaceRoot: string, relative: string, fallback: T): T {
  const absolute = join(workspaceRoot, relative);
  const content = nodeFileSystem.readText(absolute);
  if (content === null) {
    return fallback;
  }
  return JSON.parse(stripDeterministicHeader(content)) as T;
}

function emptyImpacted(): ImpactedSystems {
  return {
    data: { tables: [], fields: [] },
    runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] },
    frontend: { components: [], pages: [] },
    policies: [],
    packages: [],
    generatedArtifacts: [],
    deploy: [],
  };
}

function push(values: string[], value: string | undefined): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function sortImpact(impact: ImpactedSystems): ImpactedSystems {
  for (const values of [
    impact.data.tables,
    impact.data.fields,
    impact.runtime.commands,
    impact.runtime.queries,
    impact.runtime.liveQueries,
    impact.runtime.actions,
    impact.runtime.workflows,
    impact.frontend.components,
    impact.frontend.pages,
    impact.policies,
    impact.packages,
    impact.generatedArtifacts,
    impact.deploy,
  ]) {
    values.sort();
  }
  return impact;
}

function fileText(workspaceRoot: string, file: string): string {
  try {
    return nodeFileSystem.readText(join(workspaceRoot, file)) ?? "";
  } catch {
    return "";
  }
}

function basenameNoExt(file: string): string {
  const name = normalize(file).split("/").pop() ?? file;
  return name.replace(/\.(test|spec)?\.?(ts|tsx|js|jsx|json|md|sql|yml|yaml)$/, "");
}

function componentName(file: string): string {
  return basenameNoExt(file);
}

function git(args: string[], workspaceRoot: string): { ok: boolean; files: string[]; error?: string } {
  const result = spawnSync("git", args, {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return { ok: false, files: [], error: result.stderr || result.stdout || "git command failed" };
  }
  return {
    ok: true,
    files: result.stdout.split(/\r?\n/).map(normalize).filter(Boolean).sort(),
  };
}

function gitRoot(workspaceRoot: string): string | null {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout.trim() || null;
}

function scopeGitFilesToWorkspace(workspaceRoot: string, files: string[]): string[] {
  const root = gitRoot(workspaceRoot);
  if (!root) {
    return files;
  }
  const gitTop = normalize(resolve(root));
  const workspace = normalize(resolve(workspaceRoot));
  if (gitTop === workspace) {
    return files;
  }

  const prefix = normalize(relative(gitTop, workspace));
  if (!prefix || prefix.startsWith("..") || prefix.includes(":")) {
    return files;
  }

  return files
    .filter((file) => file.startsWith(`${prefix}/`))
    .map((file) => file.slice(prefix.length + 1))
    .filter(Boolean)
    .sort();
}

function untrackedFiles(workspaceRoot: string): string[] {
  const result = git(["ls-files", "--others", "--exclude-standard"], workspaceRoot);
  return result.ok ? result.files : [];
}

function sourceFromOptions(options: ImpactCommandOptions | TestCommandOptions): ImpactSource {
  if (options.staged) return { mode: "staged", base: "index" };
  if (options.since) return { mode: "since", base: options.since };
  if (options.featureId) return { mode: "feature", id: options.featureId };
  if (options.refactorId) return { mode: "refactor", id: options.refactorId };
  if (options.upgradeId) return { mode: "upgrade", id: options.upgradeId };
  return { mode: "changed", base: "HEAD" };
}

function readPlanFiles(workspaceRoot: string, source: ImpactSource): string[] {
  const candidates =
    source.mode === "feature"
      ? [source.id ?? "", `.forge/features/plans/${source.id}/plan.json`]
      : source.mode === "refactor"
        ? [source.id ?? "", `.forge/refactors/${source.id}/plan.json`]
        : source.mode === "upgrade"
          ? [source.id ?? "", `.forge/upgrades/${source.id}/plan.json`]
          : [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const absolute = join(workspaceRoot, candidate);
    const raw = nodeFileSystem.readText(absolute);
    if (raw === null) continue;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const files = [
      ...(((parsed.filesToCreate as Array<{ file?: string }>) ?? []).map((file) => file.file)),
      ...(((parsed.filesToModify as Array<{ file?: string }>) ?? []).map((file) => file.file)),
      ...(((parsed.filesToDelete as Array<{ file?: string }>) ?? []).map((file) => file.file)),
      ...(((parsed.generatedChanges as Array<{ file?: string }>) ?? []).map((file) => file.file)),
      ...(((parsed.affected as { files?: string[] } | undefined)?.files) ?? []),
    ];
    return files.filter((file): file is string => Boolean(file)).map(normalize).sort();
  }
  return [];
}

export function detectChangedFiles(
  workspaceRoot: string,
  source: ImpactSource,
): { files: string[]; diagnostics: Diagnostic[] } {
  if (source.mode === "feature" || source.mode === "refactor" || source.mode === "upgrade") {
    return { files: readPlanFiles(workspaceRoot, source), diagnostics: [] };
  }
  const diagnostics: Diagnostic[] = [];
  const result =
    source.mode === "staged"
      ? git(["diff", "--cached", "--name-only"], workspaceRoot)
      : source.mode === "since" && source.base
        ? git(["diff", "--name-only", source.base, "--"], workspaceRoot)
        : git(["diff", "--name-only", "HEAD", "--"], workspaceRoot);
  if (!result.ok) {
    diagnostics.push(diag("error", "FORGE_IMPACT_GIT_UNAVAILABLE", result.error ?? "git unavailable"));
    return { files: [], diagnostics };
  }
  const files = new Set(result.files);
  if (source.mode === "changed") {
    for (const file of untrackedFiles(workspaceRoot)) {
      files.add(file);
    }
  }
  return { files: scopeGitFilesToWorkspace(workspaceRoot, [...files].sort()), diagnostics };
}

function addRuntimeUsingTables(args: {
  impact: ImpactedSystems;
  tableNames: string[];
  appGraph: AppGraph;
  queryRegistry: QueryRegistry;
  liveQueryRegistry: LiveQueryRegistry;
  runtimeGraph: RuntimeGraph;
}): void {
  for (const table of args.tableNames) {
    for (const symbol of args.appGraph.symbols) {
      if (!["command", "query", "liveQuery", "action", "workflow"].includes(symbol.kind)) continue;
      const metaText = canonicalJson(symbol.meta).toLowerCase();
      const fileTextValue = symbol.file ? "" : "";
      if (!metaText.includes(table.toLowerCase()) && !fileTextValue.includes(table.toLowerCase())) {
        continue;
      }
      if (symbol.kind === "command") push(args.impact.runtime.commands, symbol.name);
      if (symbol.kind === "query") push(args.impact.runtime.queries, symbol.name);
      if (symbol.kind === "liveQuery") push(args.impact.runtime.liveQueries, symbol.name);
      if (symbol.kind === "action") push(args.impact.runtime.actions, symbol.name);
      if (symbol.kind === "workflow") push(args.impact.runtime.workflows, symbol.name);
    }
  }
  if (args.tableNames.length > 0) {
    for (const entry of args.runtimeGraph.entries) {
      push(entry.kind === "command" ? args.impact.runtime.commands : args.impact.runtime.actions, entry.name);
    }
    for (const query of args.queryRegistry.queries) push(args.impact.runtime.queries, query.name);
    for (const liveQuery of args.liveQueryRegistry.liveQueries) push(args.impact.runtime.liveQueries, liveQuery.name);
  }
}

function eventsFromText(text: string): string[] {
  const events: string[] = [];
  const regex = /ctx\.emit\s*\(\s*["'`]([^"'`]+)["'`]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text))) {
    push(events, match[1]);
  }
  return events.sort();
}

function importsPackage(text: string, packageName: string): boolean {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:from\\s+["']${escaped}(?:/[^"']*)?["']|import\\s*\\(\\s*["']${escaped}(?:/[^"']*)?["']\\s*\\)|require\\s*\\(\\s*["']${escaped}(?:/[^"']*)?["']\\s*\\))`,
  ).test(text);
}

function analyzeFiles(args: {
  workspaceRoot: string;
  files: string[];
  includeGenerated: boolean;
  excludeTests: boolean;
  appGraph: AppGraph;
  dataGraph: DataGraph;
  packageGraph: PackageGraph;
  runtimeGraph: RuntimeGraph;
  queryRegistry: QueryRegistry;
  liveQueryRegistry: LiveQueryRegistry;
  policyRegistry: PolicyRegistry;
  actionSubscriptions: ActionSubscriptions;
  workflowRegistry: WorkflowRegistry;
  workflowSubscriptions: WorkflowSubscriptions;
}): ImpactedSystems {
  const impact = emptyImpacted();
  const tableNames = args.dataGraph.tables.map((table) => table.name).sort();
  const policyNames = args.policyRegistry.policies.map((policy) => policy.name).sort();
  const packageNames = args.packageGraph.packages.map((pkg) => pkg.name).sort();

  for (const file of args.files) {
    if (!args.includeGenerated && file.startsWith(`${GENERATED}/`)) {
      push(impact.generatedArtifacts, file);
      continue;
    }
    if (args.excludeTests && /\.(test|spec)\.(ts|tsx)$/.test(file)) {
      continue;
    }
    const text = fileText(args.workspaceRoot, file);
    const lowered = file.toLowerCase();

    if (file === "src/schema.ts" || file === "src/forge/schema.ts" || lowered.includes("datagraph")) {
      for (const table of tableNames) push(impact.data.tables, table);
      addRuntimeUsingTables({ impact, tableNames, appGraph: args.appGraph, queryRegistry: args.queryRegistry, liveQueryRegistry: args.liveQueryRegistry, runtimeGraph: args.runtimeGraph });
      for (const policy of policyNames) push(impact.policies, policy);
      push(impact.generatedArtifacts, "src/forge/_generated/db.ts");
      push(impact.generatedArtifacts, "src/forge/_generated/clientTypes.ts");
    }

    for (const table of tableNames) {
      if (text.includes(table) || file.includes(table)) {
        push(impact.data.tables, table);
      }
    }
    for (const policy of policyNames) {
      if (text.includes(policy) || file.includes(policy)) {
        push(impact.policies, policy);
      }
    }
    for (const pkg of packageNames) {
      if (importsPackage(text, pkg) || file === "package.json" || file.endsWith(".lock")) {
        push(impact.packages, pkg);
      }
    }

    if (lowered.includes("/commands/")) {
      const name = basenameNoExt(file);
      push(impact.runtime.commands, name);
      for (const event of eventsFromText(text)) {
        for (const sub of args.actionSubscriptions.byEvent?.[event] ?? []) push(impact.runtime.actions, sub.actionName);
        for (const sub of args.workflowSubscriptions.byEvent?.[event] ?? []) push(impact.runtime.workflows, sub.workflowName);
      }
    } else if (lowered.includes("/queries/")) {
      const name = basenameNoExt(file);
      if (name.toLowerCase().startsWith("live")) push(impact.runtime.liveQueries, name);
      else push(impact.runtime.queries, name);
    } else if (lowered.includes("/actions/")) {
      push(impact.runtime.actions, basenameNoExt(file));
    } else if (lowered.includes("/workflows/")) {
      push(impact.runtime.workflows, basenameNoExt(file));
    }

    if (lowered.includes("/components/") && file.endsWith(".tsx")) {
      push(impact.frontend.components, componentName(file));
    }
    if (lowered.includes("/app/") && file.endsWith(".tsx")) {
      push(impact.frontend.pages, file.replace(/^web\/app/, "").replace(/\/page\.tsx$/, "") || "/");
    }
    if (["dockerfile", "docker-compose.yml", "docker-compose.yaml"].some((name) => lowered.endsWith(name)) || lowered.includes("/deploy/")) {
      push(impact.deploy, file);
    }
  }

  if (impact.data.tables.length > 0) {
    addRuntimeUsingTables({ impact, tableNames: impact.data.tables, appGraph: args.appGraph, queryRegistry: args.queryRegistry, liveQueryRegistry: args.liveQueryRegistry, runtimeGraph: args.runtimeGraph });
  }

  return sortImpact(impact);
}

function riskFor(impact: ImpactedSystems, files: string[]): ImpactRisk {
  const reasons: string[] = [];
  let level: ImpactRisk["level"] = "low";
  if (impact.data.tables.length > 0) {
    level = "high";
    reasons.push("DataGraph or schema impact detected");
  }
  if (impact.policies.length > 0) {
    level = "high";
    reasons.push("Policy surface changed");
  }
  if (impact.runtime.liveQueries.length > 0 || impact.runtime.workflows.length > 0) {
    if (level === "low") level = "medium";
    reasons.push("Reactive or workflow runtime impacted");
  }
  if (impact.runtime.commands.length > 0 || impact.runtime.queries.length > 0 || impact.runtime.actions.length > 0) {
    if (level === "low") level = "medium";
    reasons.push("Runtime entry impacted");
  }
  if (impact.packages.length > 0) {
    level = "high";
    reasons.push("Package graph or lockfile impact detected");
  }
  if (impact.deploy.length > 0) {
    level = "high";
    reasons.push("Deploy or release artifact impact detected");
  }
  if (files.some((file) => file.startsWith(`${GENERATED}/`))) {
    if (level === "low") level = "medium";
    reasons.push("Generated artifact changed");
  }
  return { level, reasons: reasons.sort() };
}

function loadArtifacts(workspaceRoot: string) {
  return {
    appGraph: readJson<AppGraph>(workspaceRoot, `${GENERATED}/appGraph.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", symbols: [], edges: [], moduleGraph: { nodes: [] }, diagnostics: [] }),
    dataGraph: readJson<DataGraph>(workspaceRoot, `${GENERATED}/dataGraph.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", tables: [], diagnostics: [] }),
    packageGraph: readJson<PackageGraph>(workspaceRoot, `${GENERATED}/packageGraph.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", packages: [] }),
    runtimeGraph: readJson<RuntimeGraph>(workspaceRoot, `${GENERATED}/runtimeGraph.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", entries: [], diagnostics: [] }),
    queryRegistry: readJson<QueryRegistry>(workspaceRoot, `${GENERATED}/queryRegistry.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", queries: [], diagnostics: [] }),
    liveQueryRegistry: readJson<LiveQueryRegistry>(workspaceRoot, `${GENERATED}/liveQueryRegistry.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", liveQueries: [], diagnostics: [] }),
    policyRegistry: readJson<PolicyRegistry>(workspaceRoot, `${GENERATED}/policyRegistry.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", policies: [], commandAuth: [], queryAuth: [], diagnostics: [] }),
    actionSubscriptions: readJson<ActionSubscriptions>(workspaceRoot, `${GENERATED}/actionSubscriptions.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", subscriptions: [], byEvent: {}, diagnostics: [] }),
    workflowRegistry: readJson<WorkflowRegistry>(workspaceRoot, `${GENERATED}/workflowRegistry.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", workflows: [], diagnostics: [] }),
    workflowSubscriptions: readJson<WorkflowSubscriptions>(workspaceRoot, `${GENERATED}/workflowSubscriptions.json`, { schemaVersion: "", generatorVersion: "", analyzerVersion: "", inputHash: "", subscriptions: [], byEvent: {}, diagnostics: [] }),
    testGraph: readJson<TestGraph>(workspaceRoot, `${GENERATED}/testGraph.json`, { schemaVersion: "0.1.0", generatorVersion: "", analyzerVersion: "", inputHash: "", tests: [], diagnostics: [] }),
  };
}

function requiredChecks(impact: ImpactedSystems): TestPlanCheck[] {
  const checks: TestPlanCheck[] = [
    { kind: "forge", command: "forge generate --check", cost: "fast", reason: "generated artifacts must stay deterministic" },
    { kind: "forge", command: "forge check", cost: "instant", reason: "runtime guards and static Forge checks" },
  ];
  if (impact.data.tables.length > 0) {
    checks.push({ kind: "forge", command: "forge db diff --json", cost: "standard", reason: "schema/table impact requires migration diff" });
    checks.push({ kind: "forge", command: "forge rls check --json", cost: "standard", reason: "data impact can affect tenant isolation" });
  }
  if (impact.policies.length > 0) {
    checks.push({ kind: "forge", command: "forge policy check --strict-policies", cost: "fast", reason: "policy impact detected" });
  }
  if (impact.packages.length > 0) {
    checks.push({ kind: "forge", command: "forge deps upgrade-check --json", cost: "standard", reason: "package impact detected" });
  }
  if (impact.deploy.length > 0) {
    checks.push({ kind: "forge", command: "forge self-host check", cost: "standard", reason: "deployment impact detected" });
  }
  return checks;
}

function costAllowed(cost: TestCost, maxCost: TestCost, includeDocker: boolean, includeBrowser: boolean): boolean {
  if (cost === "docker" && !includeDocker) return false;
  if (cost === "browser" && !includeBrowser) return false;
  return COST_ORDER.indexOf(cost) <= COST_ORDER.indexOf(maxCost);
}

function intersects(a: string[], b: string[]): string | null {
  for (const value of a) {
    if (b.includes(value)) return value;
  }
  return null;
}

function selectTests(
  testGraph: TestGraph,
  impact: ImpactedSystems,
  changedFiles: string[],
  options: { maxCost: TestCost; includeDocker: boolean; includeBrowser: boolean },
): TargetedTest[] {
  const selected: TargetedTest[] = [];
  for (const test of testGraph.tests) {
    if (test.confidence === "weak") continue;
    if (!costAllowed(test.cost, options.maxCost, options.includeDocker, options.includeBrowser)) continue;
    const reason =
      intersects(test.covers.commands, impact.runtime.commands)?.replace(/^/, "covers impacted command ") ??
      intersects(test.covers.queries, impact.runtime.queries)?.replace(/^/, "covers impacted query ") ??
      intersects(test.covers.liveQueries, impact.runtime.liveQueries)?.replace(/^/, "covers impacted liveQuery ") ??
      intersects(test.covers.actions, impact.runtime.actions)?.replace(/^/, "covers impacted action ") ??
      intersects(test.covers.workflows, impact.runtime.workflows)?.replace(/^/, "covers impacted workflow ") ??
      intersects(test.covers.tables, impact.data.tables)?.replace(/^/, "covers impacted table ") ??
      intersects(test.covers.policies, impact.policies)?.replace(/^/, "covers impacted policy ") ??
      intersects(test.covers.components, impact.frontend.components)?.replace(/^/, "covers impacted component ") ??
      intersects(test.covers.packages, impact.packages)?.replace(/^/, "covers impacted package ");
    if (!reason && !changedFiles.includes(test.file)) continue;
    selected.push({
      file: test.file,
      command: `bun test ${test.file}`,
      reason: reason ?? "changed test file",
      cost: test.cost,
      confidence: test.confidence,
    });
  }
  return selected.sort((a, b) => a.file.localeCompare(b.file));
}

function selectUiScenarioChecks(
  impact: ImpactedSystems,
  includeBrowser: boolean,
): TestPlanCheck[] {
  if (!includeBrowser) return [];
  const checks: TestPlanCheck[] = [];
  const hasFrontend = impact.frontend.components.length > 0 || impact.frontend.pages.length > 0;
  if (hasFrontend) {
    checks.push({
      kind: "forge",
      command: "forge ui smoke --scenario home-loads",
      cost: "browser",
      reason: "frontend impact should load in a browser",
    });
  }
  if (impact.runtime.liveQueries.length > 0 || impact.data.tables.length > 0) {
    checks.push({
      kind: "forge",
      command: "forge ui smoke --scenario tickets-live-update",
      cost: "browser",
      reason: "liveQuery/data impact should verify browser reactivity",
    });
  }
  if (impact.policies.length > 0) {
    checks.push({
      kind: "forge",
      command: "forge ui smoke --scenario policy-denied-visible",
      cost: "browser",
      reason: "policy impact should verify browser error/traceId handling",
    });
  }
  return checks;
}

export function analyzeImpact(options: ImpactCommandOptions): ImpactReport {
  const source = sourceFromOptions(options);
  const detected = detectChangedFiles(options.workspaceRoot, source);
  const artifacts = loadArtifacts(options.workspaceRoot);
  const changedFiles = detected.files;
  const impacted = analyzeFiles({
    workspaceRoot: options.workspaceRoot,
    files: changedFiles,
    includeGenerated: options.includeGenerated,
    excludeTests: options.excludeTests,
    ...artifacts,
  });
  const risk = riskFor(impacted, changedFiles);
  const checks = requiredChecks(impacted).map((check) => check.command);
  return {
    ok: detected.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    source,
    changedFiles,
    impacted,
    risk,
    recommendedChecks: checks,
    finalVerification: ["forge verify --strict"],
    diagnostics: detected.diagnostics,
    exitCode: detected.diagnostics.some((diagnostic) => diagnostic.severity === "error") ? 1 : 0,
  };
}

export function buildImpactTestPlan(options: TestCommandOptions): ImpactTestPlan {
  const report = analyzeImpact({
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    write: false,
    changed: options.changed,
    staged: options.staged,
    since: options.since,
    featureId: options.featureId,
    refactorId: options.refactorId,
    upgradeId: options.upgradeId,
    includeGenerated: false,
    excludeTests: false,
  });
  const artifacts = loadArtifacts(options.workspaceRoot);
  const tests = selectTests(artifacts.testGraph, report.impacted, report.changedFiles, {
    maxCost: options.maxCost,
    includeDocker: options.includeDocker,
    includeBrowser: options.includeBrowser,
  });
  return {
    schemaVersion: "0.1.0",
    source: report.source,
    changedFiles: report.changedFiles,
    impacted: report.impacted,
    risk: report.risk,
    requiredChecks: [
      ...requiredChecks(report.impacted),
      ...selectUiScenarioChecks(report.impacted, options.includeBrowser),
    ].filter((check) =>
      costAllowed(check.cost, options.maxCost, options.includeDocker, options.includeBrowser),
    ),
    tests,
    optionalChecks: ([
      { kind: "script", command: "bun run typecheck", cost: "standard", reason: "TypeScript surface changed" },
    ] satisfies TestPlanCheck[]).filter((check) =>
      costAllowed(check.cost, options.maxCost, options.includeDocker, options.includeBrowser),
    ),
    finalVerification: ["forge verify --strict"],
  };
}

export function writeTestPlan(workspaceRoot: string, plan: ImpactTestPlan): string {
  const dir = join(workspaceRoot, TEST_PLAN_DIR, plan.source.mode);
  nodeFileSystem.mkdirp(dir);
  const jsonPath = join(dir, "plan.json");
  nodeFileSystem.writeText(jsonPath, serializeCanonical(plan));
  nodeFileSystem.writeText(join(dir, "plan.md"), renderTestPlanMarkdown(plan));
  return normalize(jsonPath.replace(`${workspaceRoot}/`, ""));
}

export function renderTestPlanMarkdown(plan: ImpactTestPlan): string {
  const tests = plan.tests.map((test) => test.command).join("\n") || "# no targeted tests selected";
  const checks = plan.requiredChecks.map((check) => check.command).join("\n") || "# no checks";
  return `# Test Plan

Risk: ${plan.risk.level}

## Changed Files

${plan.changedFiles.map((file) => `- ${file}`).join("\n") || "- none"}

## Required Checks

\`\`\`bash
${checks}
\`\`\`

## Targeted Tests

\`\`\`bash
${tests}
\`\`\`

## Final

\`\`\`bash
forge verify --strict
\`\`\`
`;
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

function runCommand(workspaceRoot: string, command: string): Promise<TestRunStep> {
  const started = Date.now();
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
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      resolve({
        command,
        ok: false,
        exitCode: 1,
        durationMs: Date.now() - started,
        failureKind: "spawn-error",
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      resolve({
        command,
        ok: (code ?? 1) === 0,
        exitCode: code ?? 1,
        durationMs: Date.now() - started,
        failureKind: (code ?? 1) === 0 ? undefined : "test-failure",
        stdout,
        stderr,
      });
    });
  });
}

export async function runImpactTestPlan(
  workspaceRoot: string,
  plan: ImpactTestPlan,
  options: { bail: boolean; report?: string },
): Promise<TestRunRecord> {
  const commands = [
    ...plan.requiredChecks.map((check) => check.command),
    ...plan.tests.map((test) => test.command),
  ];
  const results: TestRunStep[] = [];
  const started = Date.now();
  for (const command of commands) {
    const result = await runCommand(workspaceRoot, command);
    results.push(result);
    if (!result.ok && options.bail) {
      break;
    }
  }
  const record: TestRunRecord = {
    schemaVersion: "0.1.0",
    id: `run_${hashStable(`${Date.now()}:${commands.join("|")}`).slice(0, 12)}`,
    changedHash: `sha256:${hashStable(canonicalJson(plan.changedFiles))}`,
    planHash: `sha256:${hashStable(canonicalJson(plan))}`,
    source: plan.source,
    commands,
    results,
    failed: results.filter((result) => !result.ok).map((result) => result.command),
    durationMs: Date.now() - started,
  };
  const reportPath = options.report ?? join(TEST_RUN_DIR, "last.json");
  const absolute = join(workspaceRoot, reportPath);
  nodeFileSystem.mkdirp(dirname(absolute));
  nodeFileSystem.writeText(absolute, serializeCanonical(record));
  if (!options.report) {
    const archive = join(workspaceRoot, TEST_RUN_DIR, `${record.id}.json`);
    nodeFileSystem.writeText(archive, serializeCanonical(record));
  }
  return record;
}

export function explainTest(workspaceRoot: string, testFile: string): ImpactResult {
  const graph = loadArtifacts(workspaceRoot).testGraph;
  const normalized = normalize(testFile);
  const test = graph.tests.find((entry) => entry.file === normalized);
  if (!test) {
    return {
      ok: false,
      diagnostics: [diag("error", "FORGE_TEST_NOT_FOUND", `test not found in TestGraph: ${testFile}`, testFile)],
      exitCode: 1,
    };
  }
  return { ok: true, test, diagnostics: [], exitCode: 0 };
}

export async function runTestCommand(options: TestCommandOptions): Promise<ImpactResult> {
  if (options.subcommand === "explain") {
    return explainTest(options.workspaceRoot, options.testFile ?? "");
  }
  let plan: ImpactTestPlan;
  if (options.subcommand === "run" && options.planPath) {
    const raw = nodeFileSystem.readText(join(options.workspaceRoot, options.planPath));
    plan = JSON.parse(raw ?? "{}") as ImpactTestPlan;
  } else {
    plan = buildImpactTestPlan(options);
  }
  if (options.write) {
    writeTestPlan(options.workspaceRoot, plan);
  }
  if (options.subcommand === "plan") {
    return { ok: true, plan, diagnostics: [], exitCode: 0 };
  }
  if (plan.requiredChecks.length === 0 && plan.tests.length === 0) {
    const diagnostic = diag("warning", "FORGE_TEST_PLAN_EMPTY", "test plan has no commands to run");
    return { ok: true, plan, diagnostics: [diagnostic], exitCode: 0 };
  }
  const run = await runImpactTestPlan(options.workspaceRoot, plan, {
    bail: options.bail,
    report: options.report,
  });
  return {
    ok: run.failed.length === 0,
    plan,
    run,
    diagnostics: run.failed.length > 0 ? [diag("error", "FORGE_TEST_RUN_FAILED", "one or more impact-selected tests failed")] : [],
    exitCode: run.failed.length > 0 ? 1 : 0,
  };
}

export function runImpactCommand(options: ImpactCommandOptions): ImpactResult {
  const report = analyzeImpact(options);
  if (options.write) {
    const plan = buildImpactTestPlan({
      subcommand: "plan",
      workspaceRoot: options.workspaceRoot,
      json: options.json,
      write: true,
      changed: options.changed,
      staged: options.staged,
      since: options.since,
      featureId: options.featureId,
      refactorId: options.refactorId,
      upgradeId: options.upgradeId,
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
    });
    writeTestPlan(options.workspaceRoot, plan);
  }
  return { ok: report.ok, report, diagnostics: report.diagnostics, exitCode: report.exitCode };
}

export function formatImpactJson(result: ImpactResult): string {
  return `${JSON.stringify(result.report ?? result.plan ?? result.test ?? result.run ?? result, null, 2)}\n`;
}

export function formatImpactHuman(result: ImpactResult): string {
  if (result.report) {
    const report = result.report;
    return `Impact detected

Risk: ${report.risk.level}

Changed files:
${report.changedFiles.map((file) => `  - ${file}`).join("\n") || "  - none"}

Runtime:
${[
  ...report.impacted.runtime.commands.map((name) => `  - command ${name}`),
  ...report.impacted.runtime.queries.map((name) => `  - query ${name}`),
  ...report.impacted.runtime.liveQueries.map((name) => `  - liveQuery ${name}`),
  ...report.impacted.runtime.actions.map((name) => `  - action ${name}`),
  ...report.impacted.runtime.workflows.map((name) => `  - workflow ${name}`),
].join("\n") || "  - none"}

Required checks:
${report.recommendedChecks.map((check) => `  - ${check}`).join("\n") || "  - none"}

Final:
  - forge verify --strict
`;
  }
  if (result.plan) {
    return renderTestPlanMarkdown(result.plan);
  }
  if (result.test) {
    return `Test: ${result.test.file}
Cost: ${result.test.cost}
Confidence: ${result.test.confidence}
Covers: ${JSON.stringify(result.test.covers, null, 2)}
`;
  }
  if (result.run) {
    return `Impact test run ${result.run.id}

${result.run.results.map((step) => `${step.ok ? "OK" : "FAIL"} ${step.command} (${step.durationMs}ms)`).join("\n")}
`;
  }
  return result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}
