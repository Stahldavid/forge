import { GENERATED_DIR } from "../emitter/constants.ts";
import { hashStable, serializeCanonical } from "../primitives/index.ts";
import type { EmitFile } from "../types/emit.ts";
import type { ModuleGraph } from "../types/app-graph.ts";
import type { ImportGuardsArtifact } from "../types/import-guards.ts";
import type { RuntimeMatrix } from "../types/runtime-matrix.ts";
import { propagateContexts } from "./propagate-contexts.ts";

export function buildImportGuardsArtifact(
  matrix: RuntimeMatrix,
  moduleGraph?: ModuleGraph,
): ImportGuardsArtifact {
  const entries = matrix.entries.map((entry) => ({
    packageName: entry.packageName,
    alias: entry.alias,
    compatible: [...entry.compatible],
    incompatible: [...entry.incompatible],
    rationale: { ...entry.rationale },
  }));

  let moduleContexts: ImportGuardsArtifact["moduleContexts"] = [];
  if (moduleGraph) {
    propagateContexts(moduleGraph);
    moduleContexts = moduleGraph.nodes
      .filter((node) => node.effectiveContexts.length > 0)
      .map((node) => ({
        file: node.file,
        effectiveContexts: [...node.effectiveContexts],
      }))
      .sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  }

  return {
    schemaVersion: matrix.schemaVersion,
    entries,
    moduleContexts,
  };
}

function renderRuntimeMatrixTs(matrix: RuntimeMatrix): string {
  return `export const runtimeMatrix = ${serializeCanonical(matrix).trim()} as const;\n`;
}

function renderImportGuardsTs(artifact: ImportGuardsArtifact): string {
  return `export const importGuards = ${serializeCanonical(artifact).trim()} as const;\n`;
}

export function buildRuntimeMatrixEmitFiles(matrix: RuntimeMatrix): EmitFile[] {
  const jsonBody = serializeCanonical(matrix);
  const tsBody = renderRuntimeMatrixTs(matrix);

  return [
    {
      path: `${GENERATED_DIR}/runtimeMatrix.json`,
      content: jsonBody,
      contentHash: hashStable(jsonBody),
    },
    {
      path: `${GENERATED_DIR}/runtimeMatrix.ts`,
      content: tsBody,
      contentHash: hashStable(tsBody),
    },
  ];
}

export function buildImportGuardsEmitFiles(
  matrix: RuntimeMatrix,
  moduleGraph?: ModuleGraph,
): EmitFile[] {
  const artifact = buildImportGuardsArtifact(matrix, moduleGraph);
  const jsonBody = serializeCanonical(artifact);
  const tsBody = renderImportGuardsTs(artifact);

  return [
    {
      path: `${GENERATED_DIR}/importGuards.json`,
      content: jsonBody,
      contentHash: hashStable(jsonBody),
    },
    {
      path: `${GENERATED_DIR}/importGuards.ts`,
      content: tsBody,
      contentHash: hashStable(tsBody),
    },
  ];
}

export function buildGuardArtifactEmitFiles(
  matrix: RuntimeMatrix,
  moduleGraph?: ModuleGraph,
): EmitFile[] {
  return [
    ...buildRuntimeMatrixEmitFiles(matrix),
    ...buildImportGuardsEmitFiles(matrix, moduleGraph),
  ];
}
