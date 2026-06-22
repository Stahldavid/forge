import { createHash } from "node:crypto";
import { join } from "node:path";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import {
  stableSortByPath,
  stableSortPackages,
  stableSortSymbols,
} from "../compiler/primitives/sort.ts";
import type { ForgeSymbol, AppGraph, ModuleNode } from "../compiler/types/app-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { PackageApi, PackageGraph } from "../compiler/types/package-graph.ts";
import type { TestGraph, TestGraphEntry } from "../compiler/types/test-graph.ts";
import {
  CAIR_SCHEMA_VERSION,
  type CairApiRef,
  type CairLexicon,
  type CairModuleRef,
  type CairPackageRef,
  type CairProjectRef,
  type CairRuleRef,
  type CairSnapshot,
  type CairSnapshotLimits,
  type CairSymbolRef,
  type CairTestRef,
} from "./types.ts";

const DEFAULT_LIMITS: CairSnapshotLimits = {
  modules: 80,
  symbols: 120,
  packages: 60,
  apis: 120,
  tests: 80,
};
const LOCAL_IMPORT_PREVIEW_LIMIT = 8;

function readJson<T>(
  workspaceRoot: string,
  relativePath: string,
  diagnostics: Diagnostic[],
): T | null {
  const absolute = join(workspaceRoot, relativePath);
  const raw = nodeFileSystem.readText(absolute);
  if (raw === null) {
    diagnostics.push(createDiagnostic({
      severity: "warning",
      code: "FORGE_CAIR_MISSING_ARTIFACT",
      message: `missing generated artifact: ${relativePath}`,
      file: relativePath,
      suggestedCommands: ["forge generate"],
    }));
    return null;
  }

  try {
    return JSON.parse(stripDeterministicHeader(raw)) as T;
  } catch (error) {
    diagnostics.push(createDiagnostic({
      severity: "error",
      code: "FORGE_CAIR_INVALID_ARTIFACT",
      message: `could not parse ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      file: relativePath,
    }));
    return null;
  }
}

function readPackageProject(workspaceRoot: string): CairProjectRef {
  const raw = nodeFileSystem.readText(join(workspaceRoot, "package.json"));
  if (raw === null) {
    return { name: "unknown", version: "unknown", type: "unknown" };
  }
  try {
    const pkg = JSON.parse(raw) as { name?: unknown; version?: unknown; forge?: unknown };
    return {
      name: typeof pkg.name === "string" ? pkg.name : "unknown",
      version: typeof pkg.version === "string" ? pkg.version : "unknown",
      type: pkg.forge && typeof pkg.forge === "object" ? "forge" : "package",
    };
  } catch {
    return { name: "unknown", version: "unknown", type: "unknown" };
  }
}

function runtimeSummary(pkg: PackageApi): string | null {
  const compatibility = pkg.runtimeCompatibility;
  if (!compatibility) {
    return null;
  }
  return [
    `node:${compatibility.node}`,
    `bun:${compatibility.bun}`,
    `browser:${compatibility.browser}`,
    `edge:${compatibility.edge}`,
  ].join(",");
}

function moduleContexts(node: ModuleNode): string[] {
  return [...new Set([...node.declaredContexts, ...node.effectiveContexts].map(String))].sort();
}

function packageImportNames(node: ModuleNode): string[] {
  return [...new Set(node.directPackageImports.map((item) => item.packageName))].sort();
}

function buildModules(appGraph: AppGraph | null): CairModuleRef[] {
  const nodes = [...(appGraph?.moduleGraph.nodes ?? [])].sort((left, right) =>
    left.file.localeCompare(right.file),
  );
  return nodes.map((node, index) => ({
    id: `M#${index + 1}`,
    file: node.file,
    packageImports: packageImportNames(node),
    localImportCount: node.localImports.length,
    localImports: node.localImports
      .map((item) => item.toModuleId)
      .sort()
      .slice(0, LOCAL_IMPORT_PREVIEW_LIMIT),
    contexts: moduleContexts(node),
  }));
}

function moduleIdByFile(modules: CairModuleRef[]): Map<string, string> {
  return new Map(modules.map((module) => [module.file, module.id]));
}

function buildSymbols(appGraph: AppGraph | null, modules: CairModuleRef[]): CairSymbolRef[] {
  const moduleIds = moduleIdByFile(modules);
  return stableSortSymbols(appGraph?.symbols ?? []).map((symbol: ForgeSymbol, index) => ({
    id: `S#${index + 1}`,
    sourceId: symbol.id,
    kind: symbol.kind,
    name: symbol.name,
    qualifiedName: symbol.qualifiedName,
    moduleId: moduleIds.get(symbol.file) ?? null,
    file: symbol.file,
    span: symbol.span,
    hash: symbol.contentHash,
  }));
}

function countPackageExports(pkg: PackageApi): number {
  return pkg.entrypoints.reduce((count, entrypoint) => count + entrypoint.exports.length, 0);
}

function buildPackages(packageGraph: PackageGraph | null): CairPackageRef[] {
  return stableSortPackages(packageGraph?.packages ?? []).map((pkg, index) => ({
    id: `P#${index + 1}`,
    name: pkg.name,
    version: pkg.version,
    entrypoints: pkg.entrypoints.length,
    exports: countPackageExports(pkg),
    runtime: runtimeSummary(pkg),
  }));
}

function buildApis(packageGraph: PackageGraph | null, packages: CairPackageRef[]): CairApiRef[] {
  const packageIds = new Map(packages.map((pkg) => [pkg.name, pkg.id]));
  const refs: Array<Omit<CairApiRef, "id">> = [];
  for (const pkg of stableSortPackages(packageGraph?.packages ?? [])) {
    for (const entrypoint of [...pkg.entrypoints].sort((left, right) => left.subpath.localeCompare(right.subpath))) {
      for (const signature of [...entrypoint.exports].sort((left, right) => left.name.localeCompare(right.name))) {
        refs.push({
          packageId: packageIds.get(pkg.name) ?? "P#?",
          packageName: pkg.name,
          entrypoint: entrypoint.subpath,
          name: signature.name,
          kind: signature.kind,
          signature: signature.signature,
        });
      }
    }
  }
  return refs.map((api, index) => ({ id: `API#${index + 1}`, ...api }));
}

function buildTests(testGraph: TestGraph | null): CairTestRef[] {
  const tests = [...(testGraph?.tests ?? [])].sort((left: TestGraphEntry, right: TestGraphEntry) =>
    left.file.localeCompare(right.file),
  );
  return tests.map((test, index) => ({
    id: `T#${index + 1}`,
    file: test.file,
    kind: test.kind,
    cost: test.cost,
    confidence: test.confidence,
    covers: {
      commands: stableSortByPath(test.covers.commands),
      queries: stableSortByPath(test.covers.queries),
      liveQueries: stableSortByPath(test.covers.liveQueries),
      actions: stableSortByPath(test.covers.actions),
      workflows: stableSortByPath(test.covers.workflows),
      tables: stableSortByPath(test.covers.tables),
      policies: stableSortByPath(test.covers.policies),
      components: stableSortByPath(test.covers.components),
      packages: stableSortByPath(test.covers.packages),
    },
  }));
}

function defaultRules(): CairRuleRef[] {
  return [
    {
      id: "R#1",
      name: "generated.no_edit",
      description: `Do not hand-edit ${GENERATED_DIR}; change source files and regenerate.`,
    },
    {
      id: "R#2",
      name: "query.before_full_read",
      description: "Use CAIR queries before reading whole files when symbol or package context is enough.",
    },
    {
      id: "R#3",
      name: "package_api.no_guess",
      description: "Use Q DEP.API before assuming npm package exports or signatures.",
    },
    {
      id: "R#4",
      name: "action.dry_run_first",
      description: "Use forge cair action --plan before applying CREATE, PATCH, import, export, semantic, or verify actions.",
    },
  ];
}

function cap<T>(items: T[], limit: number): T[] {
  return items.slice(0, limit);
}

function hashSnapshotSeed(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function buildCairSnapshot(
  workspaceRoot: string,
  limits: CairSnapshotLimits = DEFAULT_LIMITS,
): CairSnapshot {
  const diagnostics: Diagnostic[] = [];
  const appGraph = readJson<AppGraph>(workspaceRoot, `${GENERATED_DIR}/appGraph.json`, diagnostics);
  const packageGraph = readJson<PackageGraph>(workspaceRoot, `${GENERATED_DIR}/packageGraph.json`, diagnostics);
  const testGraph = readJson<TestGraph>(workspaceRoot, `${GENERATED_DIR}/testGraph.json`, diagnostics);
  const modules = buildModules(appGraph);
  const symbols = buildSymbols(appGraph, modules);
  const packages = buildPackages(packageGraph);
  const apis = buildApis(packageGraph, packages);
  const tests = buildTests(testGraph);
  const snapshotId = hashSnapshotSeed({
    project: readPackageProject(workspaceRoot),
    app: {
      inputHash: appGraph?.inputHash,
      symbols: appGraph?.symbols.map((symbol) => [symbol.id, symbol.file, symbol.contentHash]),
      modules: appGraph?.moduleGraph.nodes.map((module) => module.file),
      edges: appGraph?.edges.length ?? 0,
    },
    packages: packageGraph?.packages.map((pkg) => [pkg.name, pkg.version, pkg.contentChecksum]),
    tests: testGraph?.inputHash,
  });
  const lexicon: CairLexicon = {
    modules: cap(modules, limits.modules),
    symbols: cap(symbols, limits.symbols),
    packages: cap(packages, limits.packages),
    apis: cap(apis, limits.apis),
    tests: cap(tests, limits.tests),
  };

  return {
    schemaVersion: CAIR_SCHEMA_VERSION,
    kind: "cair.snapshot",
    snapshotId,
    project: readPackageProject(workspaceRoot),
    summary: {
      modules: modules.length,
      symbols: symbols.length,
      edges: appGraph?.edges.length ?? 0,
      packages: packages.length,
      apis: apis.length,
      tests: tests.length,
      diagnostics: diagnostics.length +
        (appGraph?.diagnostics?.length ?? 0) +
        (testGraph?.diagnostics?.length ?? 0),
    },
    limits,
    truncated: {
      modules: Math.max(0, modules.length - limits.modules),
      symbols: Math.max(0, symbols.length - limits.symbols),
      packages: Math.max(0, packages.length - limits.packages),
      apis: Math.max(0, apis.length - limits.apis),
      tests: Math.max(0, tests.length - limits.tests),
    },
    rules: defaultRules(),
    lexicon,
    diagnostics: [
      ...diagnostics,
      ...(appGraph?.diagnostics ?? []),
      ...(testGraph?.diagnostics ?? []),
    ],
    nextActions: [
      "forge cair query \"Q STATUS\"",
      "forge cair query \"Q S name=<symbol>\"",
      "forge cair query \"Q REFS S#1\"",
      "forge cair query \"Q IMPACT S#1\"",
      "forge cair query \"Q CHANGED\"",
      ...(symbols.length > 0 ? ["forge cair query \"Q SYMBOL S#1\""] : []),
      "forge cair query \"Q DEP.API package=<name> symbol=<export>\"",
      "forge cair action --dry-run \"A CREATE.SYMBOL path=src/example.ts kind=function name=example export=true createFile=true\"",
      "forge cair action --plan \"A RENAME.SYMBOL target=S#1 newName=<name> expect.file=<path> expect.kind=<kind> expect.hash=<hash>\"",
      "forge cair action \"A APPLY plan=<P#|.forge/cair/plans/...json>\"",
      "forge cair action --plan \"A MAKE.TABLE name=<name> fields=<fields>\"",
      "forge cair action --plan \"A ADD.TEST target=S#1 kind=unit\"",
      "forge cair action --plan \"A WIRE.EXPORT target=S#1 file=src/index.ts\"",
    ],
  };
}
