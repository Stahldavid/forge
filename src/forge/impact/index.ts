import { delimiter, dirname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
import type { TenantScope } from "../compiler/types/policy-registry.ts";
import type { RuntimeGraph } from "../compiler/types/runtime-graph.ts";
import type { QueryRegistry } from "../compiler/types/query-registry.ts";
import type { LiveQueryRegistry } from "../compiler/types/live-query-registry.ts";
import type { WorkflowRegistry, WorkflowSubscriptions } from "../compiler/types/workflow-registry.ts";
import type { ActionSubscriptions } from "../compiler/types/action-subscriptions.ts";
import type { TestCost, TestGraph } from "../compiler/types/test-graph.ts";
import type { AgentCapabilityMap } from "../compiler/agent-contract/types.ts";
import type { AgentContract } from "../compiler/agent-contract/types.ts";
import { resolveCommandArgv } from "../compiler/package-manager/executor.ts";
import { categorizeFiles, isVolatileForgeState, type CategorizedFileSummary } from "../workspace/change-summary.ts";
import { buildWorkspaceGitSummary } from "../workspace/git-summary.ts";
import type {
  ImpactCommandOptions,
  ImpactReport,
  ImpactRisk,
  ImpactSource,
  ImpactedSystems,
  ImpactResult,
  ImpactTestPlan,
  AuthzTestProof,
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
const DEFAULT_TEST_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;

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
  return {
    files: scopeGitFilesToWorkspace(workspaceRoot, [...files].sort()).filter(
      (file) => !isVolatileForgeState(file),
    ),
    diagnostics,
  };
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

function isPackageDependencyFile(file: string): boolean {
  return [
    "package.json",
    "package-lock.json",
    "npm-shrinkwrap.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "bun.lockb",
  ].includes(normalize(file));
}

const PACKAGE_JSON_DEPENDENCY_KEYS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "packageManager",
  "overrides",
  "resolutions",
  "engines",
] as const;

function readHeadFile(workspaceRoot: string, file: string): string | null {
  const root = gitRoot(workspaceRoot);
  if (!root) {
    return null;
  }

  const relativeToGitRoot = normalize(relative(resolve(root), resolve(workspaceRoot, file)));
  if (!relativeToGitRoot || relativeToGitRoot.startsWith("..") || relativeToGitRoot.includes(":")) {
    return null;
  }

  const result = spawnSync("git", ["show", `HEAD:${relativeToGitRoot}`], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    return null;
  }
  return result.stdout;
}

function packageJsonDependencyFingerprint(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const relevant: Record<string, unknown> = {};
    for (const key of PACKAGE_JSON_DEPENDENCY_KEYS) {
      if (Object.prototype.hasOwnProperty.call(parsed, key)) {
        relevant[key] = parsed[key];
      }
    }
    return canonicalJson(relevant);
  } catch {
    return null;
  }
}

function packageJsonHasDependencyImpact(workspaceRoot: string): boolean {
  const current = nodeFileSystem.readText(join(workspaceRoot, "package.json"));
  const previous = readHeadFile(workspaceRoot, "package.json");
  if (current === null || previous === null) {
    return true;
  }

  const currentFingerprint = packageJsonDependencyFingerprint(current);
  const previousFingerprint = packageJsonDependencyFingerprint(previous);
  if (currentFingerprint === null || previousFingerprint === null) {
    return true;
  }
  return currentFingerprint !== previousFingerprint;
}

function packageDependencyFileImpactsPackages(workspaceRoot: string, file: string): boolean {
  const normalized = normalize(file);
  if (!isPackageDependencyFile(normalized)) {
    return false;
  }
  if (normalized !== "package.json") {
    return true;
  }
  return packageJsonHasDependencyImpact(workspaceRoot);
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
    if (file === "forge.lock") {
      push(impact.generatedArtifacts, file);
      continue;
    }
    if (args.excludeTests && /\.(test|spec)\.(ts|tsx)$/.test(file)) {
      continue;
    }
    const text = fileText(args.workspaceRoot, file);
    const lowered = file.toLowerCase();
    const packageDependencyImpact = packageDependencyFileImpactsPackages(args.workspaceRoot, file);

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
      if (importsPackage(text, pkg) || packageDependencyImpact) {
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

function changeSummaryForImpact(
  workspaceRoot: string,
  source: ImpactSource,
  changedFiles: string[],
): CategorizedFileSummary {
  if (source.mode === "changed" || source.mode === "staged") {
    const git = buildWorkspaceGitSummary(workspaceRoot);
    if (git.available) {
      return source.mode === "staged" ? git.changeSummary.staged : git.changeSummary.changed;
    }
  }
  return categorizeFiles(changedFiles);
}

function derivedOnlyRisk(): ImpactRisk {
  return {
    level: "low",
    reasons: ["Only derived generated artifacts changed"],
  };
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

function readLastRunByCommand(workspaceRoot: string): Map<string, TestRunStep> {
  const raw = nodeFileSystem.readText(join(workspaceRoot, TEST_RUN_DIR, "last.json"));
  if (raw === null) {
    return new Map();
  }
  try {
    const record = JSON.parse(stripDeterministicHeader(raw)) as TestRunRecord;
    return new Map(record.results.map((result) => [result.command, result]));
  } catch {
    return new Map();
  }
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
  options: {
    workspaceRoot: string;
    maxCost: TestCost;
    includeDocker: boolean;
    includeBrowser: boolean;
    lastRunByCommand: Map<string, TestRunStep>;
  },
): TargetedTest[] {
  const selected: TargetedTest[] = [];
  for (const test of testGraph.tests) {
    const changedTestFile = changedFiles.includes(test.file);
    if (test.confidence === "weak" && !changedTestFile) continue;
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
    if (!reason && !changedTestFile) continue;
    const command = testCommandForFile(options.workspaceRoot, test.file);
    const legacyCommand = legacyBunTestCommand(test.file);
    const lastRun =
      options.lastRunByCommand.get(command) ?? options.lastRunByCommand.get(legacyCommand);
    selected.push({
      file: test.file,
      command,
      reason: reason ?? "changed test file",
      cost: test.cost,
      confidence: test.confidence,
      ...(lastRun ? { lastDurationMs: lastRun.durationMs, lastRunOk: lastRun.ok } : {}),
    });
  }
  return selected.sort((a, b) => {
    const failedBias = Number(a.lastRunOk === false) - Number(b.lastRunOk === false);
    if (failedBias !== 0) return -failedBias;
    const costBias = COST_ORDER.indexOf(a.cost) - COST_ORDER.indexOf(b.cost);
    if (costBias !== 0) return costBias;
    const durationBias = (a.lastDurationMs ?? Number.MAX_SAFE_INTEGER) - (b.lastDurationMs ?? Number.MAX_SAFE_INTEGER);
    if (durationBias !== 0) return durationBias;
    return a.file.localeCompare(b.file);
  });
}

function legacyBunTestCommand(file: string): string {
  return `bun test ${file}`;
}

function testCommandForFile(workspaceRoot: string, file: string): string {
  if (nodeFileSystem.exists(join(workspaceRoot, "bin", "forge-bun.mjs"))) {
    return `node ./bin/forge-bun.mjs test ${file}`;
  }
  return legacyBunTestCommand(file);
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
  const changeSummary = changeSummaryForImpact(options.workspaceRoot, source, changedFiles);
  const generatedChangedFiles = changeSummary.byType.generated.count;
  const authoredChangedFiles = Math.max(0, changeSummary.total.count - generatedChangedFiles);
  const derivedOnly = changeSummary.total.count > 0 && authoredChangedFiles === 0 && generatedChangedFiles > 0;
  const impacted = analyzeFiles({
    workspaceRoot: options.workspaceRoot,
    files: changedFiles,
    includeGenerated: options.includeGenerated,
    excludeTests: options.excludeTests,
    ...artifacts,
  });
  const risk = derivedOnly ? derivedOnlyRisk() : riskFor(impacted, changedFiles);
  const checks = requiredChecks(impacted).map((check) => check.command);
  return {
    ok: detected.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    source,
    changedFiles,
    authoredChangedFiles,
    generatedChangedFiles,
    derivedOnly,
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
  const lastRunByCommand = readLastRunByCommand(options.workspaceRoot);
  const tests = selectTests(artifacts.testGraph, report.impacted, report.changedFiles, {
    workspaceRoot: options.workspaceRoot,
    maxCost: options.maxCost,
    includeDocker: options.includeDocker,
    includeBrowser: options.includeBrowser,
    lastRunByCommand,
  });
  const generatedTypeScriptOnly =
    report.changedFiles.length > 0 &&
    report.changedFiles.every((file) =>
      file === "forge.lock" ||
      file.startsWith("src/forge/_generated/") ||
      (file.toLowerCase().endsWith(".md") && report.impacted.generatedArtifacts.length > 0)
    ) &&
    report.impacted.generatedArtifacts.some((file) => file.endsWith(".ts") || file.endsWith(".d.ts"));
  const standardReason = generatedTypeScriptOnly
    ? "generated TypeScript artifacts changed"
    : "TypeScript surface changed";
  return {
    schemaVersion: "0.1.0",
    source: report.source,
    changedFiles: report.changedFiles,
    authoredChangedFiles: report.authoredChangedFiles,
    generatedChangedFiles: report.generatedChangedFiles,
    derivedOnly: report.derivedOnly,
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
      { kind: "forge", command: "forge verify --standard", cost: "standard", reason: standardReason },
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
  const tests = plan.tests
    .map((test) => {
      const notes = [
        test.lastDurationMs !== undefined ? `last ${test.lastDurationMs}ms` : null,
        test.lastRunOk === false ? "failed last run" : null,
      ].filter(Boolean).join(", ");
      return notes ? `${test.command} # ${notes}` : test.command;
    })
    .join("\n") || "# no targeted tests selected";
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

function localBinExecutable(workspaceRoot: string, command: string): string | null {
  if (
    command.includes("\\") ||
    command.includes("/") ||
    command.includes(":") ||
    /\.[a-z0-9]+$/i.test(command)
  ) {
    return null;
  }
  const extensions = process.platform === "win32" ? [".cmd", ".exe", ".bat", ""] : [""];
  for (const extension of extensions) {
    const candidate = join(workspaceRoot, "node_modules", ".bin", `${command}${extension}`);
    if (nodeFileSystem.exists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function sourceRepoForgeBin(): string | null {
  const candidate = fileURLToPath(new URL("../../../bin/forge.mjs", import.meta.url));
  return nodeFileSystem.exists(candidate) ? candidate : null;
}

function nodeForgeArgs(binPath: string, args: string[]): { executable: string; args: string[] } {
  const argv = resolveCommandArgv(["node", binPath, ...args]);
  return { executable: argv[0]!, args: argv.slice(1) };
}

function addBunTestTimeout(command: string, timeoutMs: number): string {
  const parts = command.split(/\s+/).filter(Boolean);
  const usesBunWrapper =
    parts[0] === "node" &&
    parts[1]?.replace(/\\/g, "/").endsWith("bin/forge-bun.mjs") &&
    parts[2] === "test";
  if (
    ((parts[0] === "bun" && parts[1] === "test") || usesBunWrapper) &&
    !parts.some((part) => part === "--timeout" || part.startsWith("--timeout="))
  ) {
    return `${command} --timeout ${timeoutMs}`;
  }
  return command;
}

function commandArgs(workspaceRoot: string, command: string): { executable: string; args: string[] } {
  const parts = command.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return { executable: process.execPath, args: ["-e", "process.exit(0)"] };
  }
  if (parts[0] === "forge") {
    const localForge = localBinExecutable(workspaceRoot, "forge");
    if (localForge) {
      return { executable: localForge, args: parts.slice(1) };
    }
    const frameworkBin = join(workspaceRoot, "bin", "forge.mjs");
    if (nodeFileSystem.exists(frameworkBin)) {
      return nodeForgeArgs(frameworkBin, parts.slice(1));
    }
    const sourceBin = sourceRepoForgeBin();
    if (sourceBin) {
      return nodeForgeArgs(sourceBin, parts.slice(1));
    }
  }
  const local = localBinExecutable(workspaceRoot, parts[0]!);
  const argv = resolveCommandArgv([local ?? parts[0]!, ...parts.slice(1)]);
  return { executable: argv[0]!, args: argv.slice(1) };
}

function resolveTestCommandTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs && Number.isFinite(timeoutMs) && timeoutMs >= 1) {
    return Math.floor(timeoutMs);
  }
  const fromEnv = process.env.FORGE_TEST_COMMAND_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_TEST_COMMAND_TIMEOUT_MS;
}

function inferFailureKind(command: string, exitCode: number, stdout: string, stderr: string): string | undefined {
  if (exitCode === 0) {
    return undefined;
  }
  const output = `${stdout}\n${stderr}`;
  if (
    command.startsWith("forge generate --check") &&
    output.includes("FORGE_DRIFT")
  ) {
    return "generated-drift";
  }
  return "test-failure";
}

function runCommand(workspaceRoot: string, command: string, timeoutMs: number): Promise<TestRunStep> {
  const started = Date.now();
  let resolved: { executable: string; args: string[] };
  const effectiveCommand = addBunTestTimeout(command, timeoutMs);
  try {
    resolved = commandArgs(workspaceRoot, effectiveCommand);
  } catch (error) {
    return Promise.resolve({
      command: effectiveCommand,
      ok: false,
      exitCode: 1,
      durationMs: Date.now() - started,
      failureKind: "command-resolution-error",
      stderr: error instanceof Error ? error.message : String(error),
    });
  }
  const path = [join(workspaceRoot, "node_modules", ".bin"), process.env.PATH ?? ""].filter(Boolean).join(delimiter);
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const child = spawn(resolved.executable, resolved.args, {
      cwd: workspaceRoot,
      env: { ...process.env, PATH: path },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Process may have already exited.
      }
    }, timeoutMs);
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command: effectiveCommand,
        ok: false,
        exitCode: 1,
        durationMs: Date.now() - started,
        failureKind: "spawn-error",
        stderr: error.message,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      resolve({
        command: effectiveCommand,
        ok: !timedOut && (code ?? 1) === 0,
        exitCode: timedOut ? 1 : code ?? 1,
        durationMs: Date.now() - started,
        timedOut,
        failureKind: timedOut ? "timeout" : inferFailureKind(effectiveCommand, code ?? 1, stdout, stderr),
        stdout,
        stderr,
      });
    });
  });
}

export async function runImpactTestPlan(
  workspaceRoot: string,
  plan: ImpactTestPlan,
  options: { bail: boolean; report?: string; timeoutMs?: number },
): Promise<TestRunRecord> {
  const commands = [
    ...plan.requiredChecks.map((check) => check.command),
    ...plan.tests.map((test) => test.command),
  ];
  const results: TestRunStep[] = [];
  const started = Date.now();
  const timeoutMs = resolveTestCommandTimeoutMs(options.timeoutMs);
  for (const command of commands) {
    const result = await runCommand(workspaceRoot, command, timeoutMs);
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
    timeoutMs,
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

function buildAuthzTestProof(options: TestCommandOptions): ImpactResult {
  const tenant = options.tenant ?? "acme";
  const otherTenant = options.otherTenant ?? "globex";
  const policyRegistry = readJson<PolicyRegistry>(options.workspaceRoot, `${GENERATED}/policyRegistry.json`, {
    schemaVersion: "",
    generatorVersion: "",
    analyzerVersion: "",
    inputHash: "",
    policies: [],
    commandAuth: [],
    queryAuth: [],
    diagnostics: [],
  });
  const tenantScope = readJson<TenantScope>(options.workspaceRoot, `${GENERATED}/tenantScope.json`, {
    schemaVersion: "",
    generatorVersion: "",
    inputHash: "",
    tables: [],
    diagnostics: [],
  });
  const capabilityMap = readJson<AgentCapabilityMap>(options.workspaceRoot, `${GENERATED}/capabilityMap.json`, {
    schemaVersion: "0.1.0",
    generatorVersion: "",
    project: { name: "", type: "forgeos-app" },
    summary: { covered: 0, backendOnly: 0, frontendOnly: 0, warnings: 0 },
    entries: [],
    diagnostics: [],
  });
  const agentContract = readJson<AgentContract | null>(options.workspaceRoot, `${GENERATED}/agentContract.json`, null);
  const policyByName = new Map(policyRegistry.policies.map((policy) => [policy.name, policy]));
  const protectedCommands = policyRegistry.commandAuth.filter((entry) => entry.auth.kind === "policy");
  const protectedQueries = policyRegistry.queryAuth.filter((entry) => entry.auth.kind === "policy");
  const capabilityPolicyBindings = capabilityMap.entries.filter((entry) => entry.runtime?.policy).length;
  const capabilityMissingPolicy = capabilityMap.entries.filter((entry) => {
    const runtime = entry.runtime;
    if (!runtime) return false;
    const touchesTenantData =
      runtime.dependencies.some((dependency) => dependency.scope === "tenant") ||
      runtime.tablesRead.some((table) => tenantScope.tables.some((scoped) => scoped.table === table)) ||
      runtime.tablesWritten.some((table) => tenantScope.tables.some((scoped) => scoped.table === table));
    return touchesTenantData && !runtime.policy;
  });
  const permissionBackedPolicies = policyRegistry.policies.filter((policy) => policy.permissions.length > 0);
  const roleBackedPolicies = policyRegistry.policies.filter((policy) => policy.roles.length > 0);
  const missingPolicyBindings = [
    ...protectedCommands.map((entry) => entry.auth.kind === "policy" ? entry.auth.policy : undefined),
    ...protectedQueries.map((entry) => entry.auth.kind === "policy" ? entry.auth.policy : undefined),
  ].filter((policy): policy is string => typeof policy === "string" && !policyByName.has(policy));
  const checks: AuthzTestProof["checks"] = [
    {
      name: "tenant-scope-present",
      ok: tenantScope.tables.length > 0 || agentContract?.auth.requiresTenant !== true,
      message: tenantScope.tables.length > 0
        ? "tenant-scoped tables are present in tenantScope.json"
        : "no tenant-scoped tables are declared",
      evidence: tenantScope.tables.map((table) => ({ table: table.table, tenantIdColumn: table.tenantIdColumn })),
    },
    {
      name: "runtime-policies-bound",
      ok: protectedCommands.length + protectedQueries.length > 0,
      message: protectedCommands.length + protectedQueries.length > 0
        ? "runtime entries are bound to policies"
        : "no policy-bound commands or queries were found",
      evidence: {
        commands: protectedCommands.map((entry) => ({ name: entry.commandName, policy: entry.auth.kind === "policy" ? entry.auth.policy : null })),
        queries: protectedQueries.map((entry) => ({ name: entry.queryName, policy: entry.auth.kind === "policy" ? entry.auth.policy : null })),
      },
    },
    {
      name: "policy-bindings-resolve",
      ok: missingPolicyBindings.length === 0,
      message: missingPolicyBindings.length === 0
        ? "all runtime policy bindings resolve to policyRegistry entries"
        : `missing policy definitions: ${missingPolicyBindings.join(", ")}`,
      evidence: missingPolicyBindings,
    },
    {
      name: "permission-or-role-backed",
      ok: permissionBackedPolicies.length > 0 || roleBackedPolicies.length > 0,
      message: permissionBackedPolicies.length > 0
        ? "policies include permission-backed rules suitable for WorkOS-like auth"
        : roleBackedPolicies.length > 0
          ? "policies are role-backed; production auth should map roles or permissions explicitly"
          : "policies are not backed by roles or permissions",
      evidence: policyRegistry.policies.map((policy) => ({
        name: policy.name,
        roles: policy.roles,
        permissions: policy.permissions,
      })),
    },
    {
      name: "capability-map-policies",
      ok: capabilityMissingPolicy.length === 0,
      message: capabilityMissingPolicy.length === 0
        ? "tenant-sensitive capability-map runtime entries carry policy metadata"
        : "some tenant-sensitive capability-map runtime entries have no policy metadata",
      evidence: capabilityMissingPolicy.map((entry) => ({
        id: entry.id,
        runtime: entry.runtime ? { kind: entry.runtime.kind, name: entry.runtime.name } : null,
        dependencies: entry.runtime?.dependencies ?? [],
      })),
    },
  ];
  const ok = checks.every((check) => check.ok);
  const authz: AuthzTestProof = {
    schemaVersion: "0.1.0",
    tenant,
    otherTenant,
    checks,
    summary: {
      ok,
      tenantScopedTables: tenantScope.tables.length,
      protectedCommands: protectedCommands.length,
      protectedQueries: protectedQueries.length,
      capabilityPolicyBindings,
    },
    limitations: [
      "This is a generated-contract proof, not a live HTTP/FGA execution.",
      "Run forge dev --db memory and an app-specific HTTP harness to prove real token/claim enforcement.",
    ],
    nextActions: [
      `forge dev --db memory --port 0 --json`,
      `forge test authz --tenant ${tenant} --other-tenant ${otherTenant} --json`,
      "forge inspect policies --json",
      "forge inspect capabilities --json",
    ],
  };
  const diagnostics = checks
    .filter((check) => !check.ok)
    .map((check) => diag("error", "FORGE_AUTHZ_PROOF_FAILED", check.message));
  return { ok, authz, diagnostics, exitCode: ok ? 0 : 1 };
}

export function diagnosticsForImpactTestRun(run: TestRunRecord): Diagnostic[] {
  const timedOut = run.results.filter((result) => result.timedOut).map((result) => result.command);
  if (timedOut.length > 0) {
    return [diag("error", "FORGE_TEST_RUN_TIMEOUT", `impact-selected command timed out: ${timedOut.join(", ")}`)];
  }

  const resolutionFailures = run.results.filter((result) => result.failureKind === "command-resolution-error");
  if (resolutionFailures.length > 0) {
    return [diag(
      "error",
      "FORGE_TEST_COMMAND_RESOLUTION_FAILED",
      `impact-selected command could not be resolved: ${resolutionFailures.map((result) => result.command).join(", ")}`,
    )];
  }

  const generatedDrift = run.results.filter((result) => result.failureKind === "generated-drift");
  if (generatedDrift.length > 0) {
    return [diag(
      "error",
      "FORGE_IMPACT_GENERATED_DRIFT",
      `generated artifacts are stale: ${generatedDrift.map((result) => result.command).join(", ")}`,
    )];
  }

  if (run.failed.length > 0) {
    return [diag("error", "FORGE_TEST_RUN_FAILED", "one or more impact-selected tests failed")];
  }

  return [];
}

export async function runTestCommand(options: TestCommandOptions): Promise<ImpactResult> {
  if (options.subcommand === "authz") {
    return buildAuthzTestProof(options);
  }
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
    timeoutMs: options.timeoutMs,
  });
  return {
    ok: run.failed.length === 0,
    plan,
    run,
    diagnostics: diagnosticsForImpactTestRun(run),
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
  if (result.run) {
    return `${JSON.stringify({
      ok: result.ok,
      plan: result.plan,
      run: result.run,
      diagnostics: result.diagnostics,
      exitCode: result.exitCode,
    }, null, 2)}\n`;
  }
  return `${JSON.stringify(result.report ?? result.plan ?? result.test ?? result.run ?? result.authz ?? result, null, 2)}\n`;
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

${result.run.results.map((step) => {
  const timeout = step.timedOut ? `, timed out after ${result.run?.timeoutMs ?? "unknown"}ms` : "";
  const resolution = step.failureKind === "command-resolution-error" ? `, command resolution failed: ${step.stderr ?? "unknown error"}` : "";
  return `${step.ok ? "OK" : "FAIL"} ${step.command} (${step.durationMs}ms${timeout}${resolution})`;
}).join("\n")}
`;
  }
  if (result.authz) {
    const proof = result.authz;
    return `Authz proof ${proof.summary.ok ? "ok" : "failed"}

Tenant: ${proof.tenant}
Other tenant: ${proof.otherTenant}

Checks:
${proof.checks.map((check) => `  - ${check.ok ? "OK" : "FAIL"} ${check.name}: ${check.message}`).join("\n")}

Limitations:
${proof.limitations.map((item) => `  - ${item}`).join("\n")}

Next:
${proof.nextActions.map((item) => `  - ${item}`).join("\n")}
`;
  }
  return result.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
}
