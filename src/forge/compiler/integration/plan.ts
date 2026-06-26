import { join } from "node:path";
import { nodeFileSystem } from "../fs/index.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type { EmitFile, EmitPlan } from "../types/emit.ts";
import type { ForgeLock, ForgeLockEntry } from "../types/lock.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { buildRuntimeMatrix } from "../classifier/runtime-matrix.ts";
import { detectCapabilities } from "../classifier/capabilities.ts";
import { detectSecrets } from "../classifier/secrets.ts";
import { buildGuardArtifactEmitFiles } from "../guards/artifacts.ts";
import {
  FORGE_LOCK_PATH,
  FORGE_LOCK_SCHEMA_VERSION,
  GENERATED_DIR,
  GENERATOR_VERSION,
} from "../emitter/constants.ts";
import { PACKAGE_ANALYZER_VERSION } from "../package-graph/constants.ts";
import { RECIPE_SCHEMA_VERSION } from "../recipes/definitions.ts";
import { hashStable } from "../primitives/hash.ts";
import { stableSortEmitFiles, stableSortStrings } from "../primitives/index.ts";
import type { DiscoverContext } from "../orchestrator/types.ts";
import {
  createRenderContext,
  parseAdapterContext,
  renderAdapterModule,
  renderIntegrationDoc,
  renderIntegrationModule,
  renderRootFile,
  renderTestkitModule,
} from "./render.ts";

export interface IntegrationPlanInput {
  alias: string;
  recipe: IntegrationRecipe;
  classified: ClassifiedPackage[];
  allClassified: ClassifiedPackage[];
  appGraph: AppGraph;
  ctx: DiscoverContext;
  existingLock: ForgeLock | null;
}

function makeEmitFile(path: string, content: string): EmitFile {
  return {
    path,
    content,
    contentHash: hashStable(content),
  };
}

function primaryPackageName(recipe: IntegrationRecipe): string {
  return recipe.packages[0]?.packageName ?? recipe.alias;
}

function mergedCompatibleContexts(
  recipe: IntegrationRecipe,
  classified: ClassifiedPackage[],
): RuntimeContext[] {
  const contexts = new Set<RuntimeContext>(recipe.contexts.allowed);
  for (const pkg of recipe.packages) {
    for (const ctx of pkg.contexts?.allowed ?? []) {
      contexts.add(ctx);
    }
  }
  for (const item of classified) {
    for (const ctx of item.classification.compatible) {
      contexts.add(ctx);
    }
  }
  return [...contexts];
}

function shouldEmitAdapter(
  adapterFilename: string,
  compatible: RuntimeContext[],
): boolean {
  const context = parseAdapterContext(adapterFilename);
  if (context === null) {
    return true;
  }
  return compatible.includes(context);
}

function buildGeneratedPaths(
  recipe: IntegrationRecipe,
  compatible: RuntimeContext[],
): string[] {
  const paths: string[] = [];

  for (const adapter of recipe.adapters) {
    if (!shouldEmitAdapter(adapter, compatible)) {
      continue;
    }
    paths.push(`${GENERATED_DIR}/packages/${adapter}`);
  }

  for (const testkit of recipe.testkits) {
    paths.push(`${GENERATED_DIR}/testkits/${testkit}`);
  }

  for (const doc of recipe.docs) {
    paths.push(`${GENERATED_DIR}/docs/${doc}`);
  }

  for (const integration of recipe.integrations ?? []) {
    paths.push(`${GENERATED_DIR}/integrations/${integration}`);
  }

  for (const rootFile of recipe.rootFiles ?? []) {
    paths.push(rootFile);
  }

  paths.push(
    `${GENERATED_DIR}/runtimeMatrix.ts`,
    `${GENERATED_DIR}/runtimeMatrix.json`,
    `${GENERATED_DIR}/importGuards.ts`,
    `${GENERATED_DIR}/importGuards.json`,
  );

  return stableSortStrings(paths);
}

function buildLockEntry(
  recipe: IntegrationRecipe,
  classified: ClassifiedPackage[],
  generatedFiles: string[],
): ForgeLockEntry {
  const primary = classified[0]!;
  const capabilities = detectCapabilities(primary.api, recipe);
  const secrets = detectSecrets(primary.api, recipe);

  return {
    name: recipe.alias,
    version: primary.api.version,
    recipeVersion: recipe.recipeVersion,
    runtimeContexts: stableSortStrings([...primary.classification.compatible]) as ForgeLockEntry["runtimeContexts"],
    capabilities: {
      ...capabilities,
      secrets,
    },
    secrets,
    generatedFiles: stableSortStrings(generatedFiles),
    contentChecksum: primary.api.contentChecksum,
  };
}

function mergeLockPackages(
  existing: ForgeLock | null,
  newEntry: ForgeLockEntry,
  ctx: DiscoverContext,
): ForgeLock {
  const existingPackages = existing?.packages ?? [];
  const withoutAlias = existingPackages.filter(
    (entry) => entry.name !== newEntry.name,
  );

  const recipeVersion = newEntry.recipeVersion ?? RECIPE_SCHEMA_VERSION;

  return {
    schemaVersion: FORGE_LOCK_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: PACKAGE_ANALYZER_VERSION,
    inputHash: ctx.inputFingerprint,
    lockfileHash: ctx.lockfileHash,
    packageManager: ctx.packageManager,
    recipeVersion,
    packages: [...withoutAlias, newEntry].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    ),
  };
}

export function buildIntegrationEmitPlan(input: IntegrationPlanInput): EmitPlan {
  const { recipe, classified, allClassified, appGraph, ctx } = input;
  const primary = classified[0];
  if (primary === undefined) {
    throw new Error(`no classified packages for alias '${input.alias}'`);
  }

  const compatible = mergedCompatibleContexts(recipe, classified);
  const incompatible = primary.classification.incompatible;
  const secrets = detectSecrets(primary.api, recipe);
  const packageNames = recipe.packages.map((pkg) => pkg.packageName);
  const templateCtx = createRenderContext({
    alias: recipe.alias,
    recipe,
    context: "server",
    packageName: primaryPackageName(recipe),
    packageNames,
    secrets,
    compatible,
    incompatible,
  });

  const files: EmitFile[] = [];

  for (const adapter of recipe.adapters) {
    if (!shouldEmitAdapter(adapter, compatible)) {
      continue;
    }
    const context = parseAdapterContext(adapter) ?? "server";
    files.push(
      makeEmitFile(
        `${GENERATED_DIR}/packages/${adapter}`,
        renderAdapterModule({
          alias: recipe.alias,
          recipe,
          context,
          packageName: primaryPackageName(recipe),
          packageNames,
          secrets,
          compatible,
          incompatible,
        }),
      ),
    );
  }

  for (const integration of recipe.integrations ?? []) {
    files.push(
      makeEmitFile(
        `${GENERATED_DIR}/integrations/${integration}`,
        renderIntegrationModule(integration, templateCtx),
      ),
    );
  }

  for (const rootFile of recipe.rootFiles ?? []) {
    const content = renderRootFile(rootFile, templateCtx);
    files.push({
      path: rootFile,
      content,
      contentHash: hashStable(content),
      header: rootFile.endsWith(".env.example") ? "none" : "deterministic",
    });
  }

  for (const testkit of recipe.testkits) {
    files.push(
      makeEmitFile(
        `${GENERATED_DIR}/testkits/${testkit}`,
        renderTestkitModule(recipe.alias, primaryPackageName(recipe), templateCtx),
      ),
    );
  }

  for (const doc of recipe.docs) {
    files.push(
      makeEmitFile(
        `${GENERATED_DIR}/docs/${doc}`,
        renderIntegrationDoc({
          alias: recipe.alias,
          recipe,
          packageNames,
          secrets,
          compatible,
          incompatible,
        }),
      ),
    );
  }

  const matrix = buildRuntimeMatrix(allClassified);
  files.push(...buildGuardArtifactEmitFiles(matrix, appGraph.moduleGraph));

  const generatedFiles = buildGeneratedPaths(recipe, compatible);
  const lockEntry = buildLockEntry(recipe, classified, generatedFiles);
  const lock = mergeLockPackages(input.existingLock, lockEntry, ctx);

  return {
    files: stableSortEmitFiles(files),
    orphanedFiles: [],
    lock,
  };
}

export function loadExistingForgeLock(workspaceRoot: string): ForgeLock | null {
  const absolute = join(workspaceRoot, FORGE_LOCK_PATH);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }

  try {
    return JSON.parse((nodeFileSystem.readText(absolute) ?? "")) as ForgeLock;
  } catch {
    return null;
  }
}
