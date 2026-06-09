import type { AppGraph } from "../types/app-graph.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type { EmitFile, EmitPlan } from "../types/emit.ts";
import type { ForgeLock, ForgeLockEntry } from "../types/lock.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildRuntimeMatrix } from "../classifier/runtime-matrix.ts";
import { detectCapabilities } from "../classifier/capabilities.ts";
import { detectSecrets } from "../classifier/secrets.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { RECIPE_SCHEMA_VERSION } from "../recipes/definitions.ts";
import {
  FORGE_LOCK_SCHEMA_VERSION,
  GENERATED_DIR,
  GENERATOR_VERSION,
} from "../emitter/constants.ts";
import { PACKAGE_ANALYZER_VERSION } from "../package-graph/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { stableSortEmitFiles } from "../primitives/sort.ts";
import { detectOrphanedGeneratedFiles } from "./orphans.ts";
import type { DiscoverContext } from "./types.ts";
import {
  serializeAppGraphJson,
  serializeAppGraphTs,
  serializeImportGuardsJson,
  serializeImportGuardsTs,
  serializePackageGraphJson,
  serializePackageGraphTs,
  serializeRuntimeMatrixJson,
  serializeRuntimeMatrixTs,
} from "./serialize.ts";

export interface PlanInput {
  appGraph: AppGraph;
  packageGraph: PackageGraph;
  classified: ClassifiedPackage[];
  ctx: DiscoverContext;
}

function makeEmitFile(path: string, content: string): EmitFile {
  return {
    path,
    content,
    contentHash: hashStable(content),
  };
}

function buildLockEntry(pkg: ClassifiedPackage): ForgeLockEntry {
  const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
  const secrets = detectSecrets(pkg.api, recipe ?? undefined);
  const capabilities = detectCapabilities(pkg.api, recipe ?? undefined);

  return {
    name: pkg.api.name,
    version: pkg.api.version,
    ...(recipe?.recipeVersion !== undefined
      ? { recipeVersion: recipe.recipeVersion }
      : {}),
    runtimeContexts: [...pkg.classification.compatible],
    capabilities: {
      ...capabilities,
      secrets,
    },
    secrets,
    generatedFiles: [],
    contentChecksum: pkg.api.contentChecksum,
  };
}

function buildForgeLock(input: PlanInput): ForgeLock {
  const recipeVersions = input.classified
    .map((pkg) => pkg.recipe?.recipeVersion)
    .filter((version): version is string => version !== undefined);

  const recipeVersion =
    recipeVersions.length > 0
      ? recipeVersions.sort()[0]
      : RECIPE_SCHEMA_VERSION;

  return {
    schemaVersion: FORGE_LOCK_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: PACKAGE_ANALYZER_VERSION,
    inputHash: input.ctx.inputFingerprint,
    lockfileHash: input.ctx.lockfileHash,
    packageManager: input.ctx.packageManager,
    recipeVersion,
    packages: input.classified
      .filter((pkg) => resolveByPackageName(pkg.api.name) !== null)
      .map(buildLockEntry),
  };
}

export function plan(input: PlanInput): EmitPlan {
  const matrix = buildRuntimeMatrix(input.classified);

  const files: EmitFile[] = [
    makeEmitFile(
      `${GENERATED_DIR}/appGraph.ts`,
      serializeAppGraphTs(input.appGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/appGraph.json`,
      serializeAppGraphJson(input.appGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/packageGraph.ts`,
      serializePackageGraphTs(input.packageGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/packageGraph.json`,
      serializePackageGraphJson(input.packageGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/runtimeMatrix.ts`,
      serializeRuntimeMatrixTs(matrix),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/runtimeMatrix.json`,
      serializeRuntimeMatrixJson(matrix),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/importGuards.ts`,
      serializeImportGuardsTs(matrix, input.appGraph.moduleGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/importGuards.json`,
      serializeImportGuardsJson(matrix, input.appGraph.moduleGraph),
    ),
  ];

  const sortedFiles = stableSortEmitFiles(files);
  const plannedPathSet = new Set(sortedFiles.map((file) => file.path));
  const orphanedFiles = detectOrphanedGeneratedFiles(
    input.ctx.workspaceRoot,
    input.ctx.generatedDir,
    plannedPathSet,
  );

  const lock = buildForgeLock(input);

  return {
    files: sortedFiles,
    orphanedFiles,
    lock,
  };
}
