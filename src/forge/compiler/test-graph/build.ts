import { basename } from "node:path";
import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { walkWorkspaceSources } from "../orchestrator/workspace-index.ts";
import { stableSortStrings } from "../primitives/sort.ts";
import type { AppGraph, ForgeKind, SourceFile } from "../types/app-graph.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type {
  TestConfidence,
  TestCost,
  TestCoverage,
  TestGraph,
  TestGraphEntry,
  TestKind,
  TestPlanRegistry,
} from "../types/test-graph.ts";

const TEST_RE = /\.(test|spec)\.(ts|tsx)$/;

function isTemporaryTestPath(path: string): boolean {
  return path.split("/").some((segment) => segment === ".tmp" || segment === "__tmp__");
}

function isTestGraphCandidate(path: string): boolean {
  return TEST_RE.test(path) && !isTemporaryTestPath(path);
}

function emptyCoverage(): TestCoverage {
  return {
    commands: [],
    queries: [],
    liveQueries: [],
    actions: [],
    workflows: [],
    tables: [],
    policies: [],
    components: [],
    packages: [],
  };
}

function pushUnique(values: string[], value: string): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function collectTestsFromDisk(workspaceRoot: string): SourceFile[] {
  const { sources } = walkWorkspaceSources({
    workspaceRoot,
    roots: ["tests", "web"],
    excludeRelativePath: (path) => !isTestGraphCandidate(path),
  });
  return sources.sort((a, b) => a.path.localeCompare(b.path));
}

function symbolsByKind(appGraph: AppGraph, kind: ForgeKind): string[] {
  return stableSortStrings(
    appGraph.symbols
      .filter((symbol) => symbol.kind === kind)
      .map((symbol) => symbol.name),
  );
}

function componentNames(sources: SourceFile[]): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    if (!source.path.endsWith(".tsx")) {
      continue;
    }
    if (!source.path.includes("/components/") && !source.path.includes("\\components\\")) {
      if (!/\b(react|components)\b/.test(source.path) || !TEST_RE.test(source.path)) {
        continue;
      }
    }
    names.add(basename(source.path).replace(/\.(test|spec)?\.?tsx$/, ""));
  }
  return stableSortStrings([...names]);
}

function hasBrowserAutomationSignal(path: string, text: string): boolean {
  const loweredPath = path.toLowerCase();
  const loweredText = text.toLowerCase();
  return (
    loweredPath.includes("playwright") ||
    /^\s*import\s+["'](?:@playwright\/test|playwright)["'];?/m.test(loweredText) ||
    /^\s*import\s+.*\s+from\s+["'](?:@playwright\/test|playwright)["'];?/m.test(loweredText) ||
    /^\s*const\s+\w+\s*=\s*require\(["'](?:@playwright\/test|playwright)["']\)/m.test(loweredText) ||
    /\b(chromium|firefox|webkit)\s*\./.test(loweredText) ||
    /\bpage\.(goto|locator|click|fill|screenshot)\b/.test(loweredText)
  );
}

function hasDockerOrExternalPostgresSignal(path: string, text: string): boolean {
  const loweredPath = path.toLowerCase();
  const loweredText = text.toLowerCase();
  return (
    loweredPath.includes("/docker/") ||
    loweredPath.includes("\\docker\\") ||
    loweredPath.includes("docker-compose") ||
    loweredPath.includes("/postgres/") ||
    loweredPath.includes("\\postgres\\") ||
    loweredText.includes("testcontainers") ||
    loweredText.includes("docker-compose") ||
    loweredText.includes("postgres://") ||
    loweredText.includes("postgresql://") ||
    /\bnew\s+postgres(?:ql)?container\b/.test(loweredText)
  );
}

function inferKind(path: string, text: string): TestKind {
  const lowered = path.toLowerCase();
  if (lowered.includes("/e2e/") || hasBrowserAutomationSignal(path, text)) {
    return "e2e";
  }
  if (lowered.includes("/react/") || lowered.includes("/components/") || path.endsWith(".tsx")) {
    return "frontend";
  }
  if (lowered.includes("/integration/") || lowered.includes("/live/") || lowered.includes("/workflow")) {
    return "integration";
  }
  if (lowered.includes("/tests/")) {
    return "unit";
  }
  return "unknown";
}

function inferCost(path: string, text: string, kind: TestKind): TestCost {
  const lowered = `${path}\n${text}`.toLowerCase();
  if (hasBrowserAutomationSignal(path, text)) {
    return "browser";
  }
  if (hasDockerOrExternalPostgresSignal(path, text)) {
    return "docker";
  }
  if (lowered.includes("e2e") || lowered.includes("timeout 120000")) {
    return "slow";
  }
  if (kind === "integration" || kind === "frontend") {
    return "standard";
  }
  return "fast";
}

function mentionConfidence(path: string, text: string, group: string, name: string): TestConfidence | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathHit = path.toLowerCase().includes(name.toLowerCase());
  const apiHit = new RegExp(`api\\.${group}\\.${escaped}\\b`).test(text);
  const helperHit = new RegExp(`forge\\.test\\.[a-zA-Z]+\\([^)]*${escaped}`).test(text);
  const importHit = new RegExp(`from\\s+["'][^"']*${escaped}["']`).test(text);
  const stringHit = new RegExp(`["'\`]${escaped}["'\`]`).test(text);
  const wordHit = new RegExp(`\\b${escaped}\\b`).test(text);

  if (pathHit || apiHit || helperHit || importHit) {
    return "confirmed";
  }
  if (stringHit || wordHit) {
    return "probable";
  }
  return null;
}

function stronger(a: TestConfidence, b: TestConfidence): TestConfidence {
  const rank = { weak: 0, probable: 1, confirmed: 2 };
  return rank[b] > rank[a] ? b : a;
}

function inferCoverage(args: {
  path: string;
  text: string;
  appGraph: AppGraph;
  packageGraph: PackageGraph;
  allSources: SourceFile[];
}): { covers: TestCoverage; confidence: TestConfidence; reasons: string[] } {
  const { path, text, appGraph, packageGraph, allSources } = args;
  const covers = emptyCoverage();
  const reasons: string[] = [];
  let confidence: TestConfidence = "weak";
  const groups: Array<[keyof TestCoverage, string, string[]]> = [
    ["commands", "commands", symbolsByKind(appGraph, "command")],
    ["queries", "queries", symbolsByKind(appGraph, "query")],
    ["liveQueries", "liveQueries", symbolsByKind(appGraph, "liveQuery")],
    ["actions", "actions", symbolsByKind(appGraph, "action")],
    ["workflows", "workflows", symbolsByKind(appGraph, "workflow")],
    ["tables", "tables", symbolsByKind(appGraph, "schema.table")],
    ["policies", "policies", symbolsByKind(appGraph, "policy")],
    ["components", "components", componentNames(allSources)],
    ["packages", "packages", packageGraph.packages.map((pkg) => pkg.name).sort()],
  ];

  for (const [coverageKey, apiGroup, names] of groups) {
    for (const name of names) {
      const hit = mentionConfidence(path, text, apiGroup, name);
      if (!hit) {
        continue;
      }
      pushUnique(covers[coverageKey], name);
      confidence = stronger(confidence, hit);
      reasons.push(`${hit}: ${coverageKey} ${name}`);
    }
  }

  for (const values of Object.values(covers)) {
    values.sort();
  }
  reasons.sort();
  return { covers, confidence, reasons };
}

export function buildTestGraph(input: {
  workspaceRoot: string;
  inputHash: string;
  appGraph: AppGraph;
  packageGraph: PackageGraph;
  sources: SourceFile[];
}): TestGraph {
  const diskTests = collectTestsFromDisk(input.workspaceRoot);
  const byPath = new Map<string, SourceFile>();
  for (const source of input.sources) {
    if (isTestGraphCandidate(source.path)) {
      byPath.set(source.path, source);
    }
  }
  for (const source of diskTests) {
    byPath.set(source.path, source);
  }

  const allSources = [...input.sources.filter((s) => isTestGraphCandidate(s.path)), ...diskTests];
  const tests: TestGraphEntry[] = [...byPath.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((source) => {
      const kind = inferKind(source.path, source.text);
      const inferred = inferCoverage({
        path: source.path,
        text: source.text,
        appGraph: input.appGraph,
        packageGraph: input.packageGraph,
        allSources,
      });
      return {
        file: source.path,
        kind,
        cost: inferCost(source.path, source.text, kind),
        confidence: inferred.confidence,
        covers: inferred.covers,
        reasons: inferred.reasons,
      };
    });

  return {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: "test-graph-0.1.0",
    inputHash: input.inputHash,
    tests,
    diagnostics: [],
  };
}

export function buildTestPlanRegistry(): TestPlanRegistry {
  return {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    commands: [
      "forge impact --changed --json",
      "forge test plan --changed --json",
      "forge test run --changed --json",
      "forge test run --changed --timeout-ms <ms> --json",
      "forge test explain <testFile> --json",
      "forge verify --changed",
      "forge verify --fast",
      "forge verify --smoke",
      "forge verify --standard",
      "forge verify --strict",
    ],
    generatedArtifacts: [
      "src/forge/_generated/testGraph.json",
      "src/forge/_generated/testGraph.ts",
      "src/forge/_generated/testPlanRegistry.json",
      "src/forge/_generated/testPlanRegistry.ts",
    ],
    planDirectory: ".forge/test-plans",
    runDirectory: ".forge/test-runs",
    costs: ["instant", "fast", "standard", "slow", "docker", "browser"],
  };
}
