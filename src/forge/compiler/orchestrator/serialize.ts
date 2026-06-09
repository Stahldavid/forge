import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph } from "../types/data-graph.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type { RuntimeMatrix } from "../types/runtime-matrix.ts";
import type { ImportGuardsArtifact } from "../types/import-guards.ts";
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

export type { ImportGuardsArtifact };
