import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph } from "../types/data-graph.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type { RuntimeMatrix } from "../types/runtime-matrix.ts";
import type { ImportGuardsArtifact } from "../types/import-guards.ts";
import type { DevManifest } from "../types/dev-manifest.ts";
import type { MockMapEntry, RuntimeGraph } from "../types/runtime-graph.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { GENERATED_DIR } from "../emitter/constants.ts";
import { serializeCanonical } from "../primitives/serialize.ts";
import { buildImportGuardsArtifact } from "../guards/artifacts.ts";

export function serializeAppGraphJson(graph: AppGraph): string {
  const payload = {
    schemaVersion: graph.schemaVersion,
    generatorVersion: graph.generatorVersion,
    analyzerVersion: graph.analyzerVersion,
    inputHash: graph.inputHash,
    symbols: graph.symbols,
    edges: graph.edges,
    moduleGraph: graph.moduleGraph,
  };
  return serializeCanonical(payload);
}

export function serializeAppGraphTs(graph: AppGraph): string {
  const parsed: unknown = JSON.parse(serializeAppGraphJson(graph).trimEnd());
  return `export const appGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializePackageGraphJson(graph: PackageGraph): string {
  return serializeCanonical(graph);
}

export function serializePackageGraphTs(graph: PackageGraph): string {
  const parsed: unknown = JSON.parse(serializePackageGraphJson(graph).trimEnd());
  return `export const packageGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeRuntimeMatrixJson(matrix: RuntimeMatrix): string {
  return serializeCanonical(matrix);
}

export function serializeRuntimeMatrixTs(matrix: RuntimeMatrix): string {
  const parsed: unknown = JSON.parse(serializeRuntimeMatrixJson(matrix).trimEnd());
  return `export const runtimeMatrix = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeImportGuardsJson(
  matrix: RuntimeMatrix,
  moduleGraph?: AppGraph["moduleGraph"],
): string {
  return serializeCanonical(buildImportGuardsArtifact(matrix, moduleGraph));
}

export function serializeImportGuardsTs(
  matrix: RuntimeMatrix,
  moduleGraph?: AppGraph["moduleGraph"],
): string {
  const artifact = buildImportGuardsArtifact(matrix, moduleGraph);
  return `export const importGuards = ${JSON.stringify(artifact, null, 2)} as const;\n`;
}

export function serializeDataGraphJson(graph: DataGraph): string {
  const payload = {
    schemaVersion: graph.schemaVersion,
    generatorVersion: graph.generatorVersion,
    analyzerVersion: graph.analyzerVersion,
    inputHash: graph.inputHash,
    tables: graph.tables,
  };
  return serializeCanonical(payload);
}

export function serializeDataGraphTs(graph: DataGraph): string {
  const parsed: unknown = JSON.parse(serializeDataGraphJson(graph).trimEnd());
  return `export const dataGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeRuntimeGraphJson(graph: RuntimeGraph): string {
  const payload = {
    schemaVersion: graph.schemaVersion,
    generatorVersion: graph.generatorVersion,
    analyzerVersion: graph.analyzerVersion,
    inputHash: graph.inputHash,
    entries: graph.entries,
  };
  return serializeCanonical(payload);
}

export function serializeRuntimeGraphTs(graph: RuntimeGraph): string {
  const parsed: unknown = JSON.parse(serializeRuntimeGraphJson(graph).trimEnd());
  return `export const runtimeGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeRuntimeRegistryTs(graph: RuntimeGraph): string {
  const registry: Record<
    string,
    { kind: "command" | "action"; file: string; moduleId: string }
  > = {};

  for (const entry of graph.entries) {
    registry[entry.name] = {
      kind: entry.kind,
      file: entry.file,
      moduleId: entry.moduleId,
    };
  }

  return `export const runtimeRegistry = ${JSON.stringify(registry, null, 2)} as const;\n`;
}

export function buildMockMapEntries(classified: ClassifiedPackage[]): MockMapEntry[] {
  const entries: MockMapEntry[] = [];
  const seen = new Set<string>();

  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    if (!recipe || recipe.testkits.length === 0) {
      continue;
    }

    const packageName = recipe.packages[0]?.packageName ?? recipe.alias;
    if (seen.has(packageName)) {
      continue;
    }
    seen.add(packageName);

    const testkit = [...recipe.testkits].sort()[0];
    if (!testkit) {
      continue;
    }

    entries.push({
      packageName,
      mockFile: `${GENERATED_DIR}/testkits/${testkit}`,
    });
  }

  return entries.sort((a, b) => a.packageName.localeCompare(b.packageName));
}

export function serializeMockMapJson(entries: MockMapEntry[]): string {
  return serializeCanonical({ entries });
}

export function serializeMockMapTs(entries: MockMapEntry[]): string {
  const map: Record<string, string> = {};
  for (const entry of entries) {
    map[entry.packageName] = entry.mockFile;
  }
  return `export const mockMap = ${JSON.stringify(map, null, 2)} as const;\n`;
}

export function serializeDevManifestJson(manifest: DevManifest): string {
  const payload = {
    schemaVersion: manifest.schemaVersion,
    generatorVersion: manifest.generatorVersion,
    analyzerVersion: manifest.analyzerVersion,
    inputHash: manifest.inputHash,
    routes: manifest.routes,
    entries: manifest.entries,
    workflows: manifest.workflows,
    diagnostics: manifest.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeDevManifestTs(manifest: DevManifest): string {
  const parsed: unknown = JSON.parse(serializeDevManifestJson(manifest).trimEnd());
  return `export const devManifest = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export type { ImportGuardsArtifact };
