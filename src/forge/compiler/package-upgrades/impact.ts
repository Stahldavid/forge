import { resolveByPackageName } from "../recipes/registry.ts";
import type { AppGraph, ForgeSymbol } from "../types/app-graph.ts";
import type { RuntimeGraph } from "../types/runtime-graph.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type { LiveQueryRegistry } from "../types/live-query-registry.ts";
import type { WorkflowRegistry } from "../types/workflow-registry.ts";
import type { PackageApiDiff, UpgradeImpact } from "./types.ts";

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))].sort();
}

function symbolsByFile(appGraph: AppGraph): Map<string, ForgeSymbol[]> {
  const byFile = new Map<string, ForgeSymbol[]>();
  for (const symbol of appGraph.symbols) {
    const list = byFile.get(symbol.file) ?? [];
    list.push(symbol);
    byFile.set(symbol.file, list);
  }
  return byFile;
}

function attachAffectedCallsites(apiDiff: PackageApiDiff, appGraph: AppGraph, files: string[]): void {
  const symbols = symbolsByFile(appGraph);
  const callsites = files.flatMap((file) =>
    (symbols.get(file) ?? []).map((symbol) => ({
      file,
      symbolName: symbol.name,
      symbolKind: symbol.kind,
    })),
  );

  for (const change of apiDiff.changedSignatures) {
    change.affectedCallsites = callsites;
  }
}

export function analyzeUpgradeImpact(input: {
  packageName: string;
  appGraph: AppGraph;
  runtimeGraph: RuntimeGraph;
  queryRegistry: QueryRegistry;
  liveQueryRegistry: LiveQueryRegistry;
  workflowRegistry: WorkflowRegistry;
  apiDiff: PackageApiDiff;
}): UpgradeImpact {
  const imports = input.appGraph.moduleGraph.nodes
    .flatMap((node) =>
      node.directPackageImports
        .filter((pkgImport) => pkgImport.packageName === input.packageName)
        .map((pkgImport) => ({
          file: node.file,
          specifier: pkgImport.specifier,
          importKind: pkgImport.importKind,
        })),
    )
    .sort((a, b) => `${a.file}:${a.specifier}`.localeCompare(`${b.file}:${b.specifier}`));

  const files = uniqueSorted(imports.map((imp) => imp.file));
  const symbols = symbolsByFile(input.appGraph);
  const commandNames = new Set(
    input.runtimeGraph.entries
      .filter((entry) => entry.kind === "command" && files.includes(entry.file))
      .map((entry) => entry.name),
  );
  const actionNames = new Set(
    input.runtimeGraph.entries
      .filter((entry) => entry.kind === "action" && files.includes(entry.file))
      .map((entry) => entry.name),
  );

  for (const file of files) {
    for (const symbol of symbols.get(file) ?? []) {
      if (symbol.kind === "command") {
        commandNames.add(symbol.name);
      }
      if (symbol.kind === "action") {
        actionNames.add(symbol.name);
      }
    }
  }

  const queries = uniqueSorted(
    input.queryRegistry.queries
      .filter((query) => files.includes(query.file))
      .map((query) => query.name),
  );
  const liveQueries = uniqueSorted(
    input.liveQueryRegistry.liveQueries
      .filter((query) => files.includes(query.file))
      .map((query) => query.name),
  );
  const workflows = uniqueSorted(
    input.workflowRegistry.workflows
      .filter((workflow) => files.includes(workflow.file))
      .map((workflow) => workflow.name),
  );
  const workflowSteps = uniqueSorted(
    input.workflowRegistry.workflows
      .filter((workflow) => files.includes(workflow.file))
      .flatMap((workflow) => workflow.steps.map((step) => `${workflow.name}.${step.name}`)),
  );
  const frontendComponents = uniqueSorted(
    input.appGraph.symbols
      .filter((symbol) => files.includes(symbol.file) && symbol.kind === "endpoint")
      .map((symbol) => symbol.name),
  );
  const generatedAdapters = uniqueSorted(
    (resolveByPackageName(input.packageName)?.adapters ?? []).map(
      (adapter) => `src/forge/_generated/packages/${adapter}`,
    ),
  );
  const tests = uniqueSorted(
    files
      .map((file) => file.replace(/^src\//, "tests/").replace(/\.(tsx?|jsx?)$/, ".test.ts"))
      .filter((file) => file.startsWith("tests/")),
  );

  attachAffectedCallsites(input.apiDiff, input.appGraph, files);

  return {
    files,
    imports,
    commands: [...commandNames].sort(),
    queries,
    liveQueries,
    actions: [...actionNames].sort(),
    workflows,
    workflowSteps,
    endpoints: uniqueSorted(
      input.appGraph.symbols
        .filter((symbol) => files.includes(symbol.file) && symbol.kind === "endpoint")
        .map((symbol) => symbol.name),
    ),
    frontendComponents,
    generatedAdapters,
    tests,
  };
}
