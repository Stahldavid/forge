import { buildDataGraph } from "../data-graph/build.ts";
import { buildActionSubscriptions } from "../action-subscriptions/build.ts";
import {
  buildWorkflowRegistry,
  buildWorkflowSubscriptions,
} from "../workflow-registry/build.ts";
import {
  buildTelemetryRegistry,
  buildTelemetrySinks,
} from "../telemetry-registry/build.ts";
import {
  buildPermissionMatrixFromRegistry,
  buildPolicyRegistry,
  buildTenantScope,
} from "../policy-registry/build.ts";
import {
  augmentEnvSchemaWithPublicVars,
  buildConfigRegistry,
  buildEnvSchema,
  buildSecretRegistry,
} from "../secret-registry/build.ts";
import { buildAiModels, buildAiRegistry } from "../ai-registry/build.ts";
import { buildQueryRegistry } from "../query-registry/build.ts";
import { buildApiSurface } from "../api-surface/build.ts";
import { buildClientManifest } from "../client-sdk/build-manifest.ts";
import {
  renderClientManifestTs,
  renderClientTs,
  renderClientTypesTs,
} from "../client-sdk/render-client.ts";
import { buildSqlPlan } from "../data-graph/sql/ddl.ts";
import { buildDevManifest } from "../dev-manifest/build.ts";
import { buildRuntimeGraph } from "../runtime-graph/build.ts";
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
  serializeDataGraphJson,
  serializeDataGraphTs,
  serializeImportGuardsJson,
  serializeImportGuardsTs,
  serializeMockMapJson,
  serializeMockMapTs,
  serializePackageGraphJson,
  serializePackageGraphTs,
  serializeRuntimeGraphJson,
  serializeRuntimeGraphTs,
  serializeRuntimeMatrixJson,
  serializeRuntimeMatrixTs,
  serializeRuntimeRegistryTs,
  serializeDevManifestJson,
  serializeDevManifestTs,
  serializeSqlPlanJsonExport,
  serializeSqlPlanTsExport,
  serializeDbJsonExport,
  serializeDbTsExport,
  serializeActionSubscriptionsJson,
  serializeActionSubscriptionsTs,
  serializeWorkflowRegistryJson,
  serializeWorkflowRegistryTs,
  serializeWorkflowSubscriptionsJson,
  serializeWorkflowSubscriptionsTs,
  serializeTelemetryRegistryJson,
  serializeTelemetryRegistryTs,
  serializeTelemetrySinksJson,
  serializeTelemetrySinksTs,
  serializePolicyRegistryJson,
  serializePolicyRegistryTs,
  serializePermissionMatrixJson,
  serializePermissionMatrixTs,
  serializeTenantScopeJson,
  serializeTenantScopeTs,
  serializeAuthContextTs,
  serializeSecretsContextTs,
  serializeSecretRegistryJson,
  serializeSecretRegistryTs,
  serializeEnvSchemaJson,
  serializeEnvSchemaTs,
  serializeConfigRegistryJson,
  serializeConfigRegistryTs,
  serializeAiRegistryJson,
  serializeAiRegistryTs,
  serializeAiProvidersJson,
  serializeAiProvidersTs,
  serializeAiModelsJson,
  serializeAiModelsTs,
  serializeAiContextTs,
  serializeQueryRegistryJson,
  serializeQueryRegistryTs,
  serializeApiJson,
  serializeApiTsExport,
  serializeServerApiTsExport,
  serializeClientApiTsExport,
  serializeClientManifestJson,
  buildMockMapEntries,
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
  const dataGraph = buildDataGraph(input.appGraph);
  const sqlPlan = buildSqlPlan(dataGraph);
  const actionSubscriptions = buildActionSubscriptions(input.appGraph);
  const workflowRegistry = buildWorkflowRegistry(input.appGraph);
  const workflowSubscriptions = buildWorkflowSubscriptions(workflowRegistry);
  const telemetryRegistry = buildTelemetryRegistry(input.appGraph);
  const telemetrySinks = buildTelemetrySinks(input.classified);
  const policyRegistry = buildPolicyRegistry(input.appGraph);
  const permissionMatrix = buildPermissionMatrixFromRegistry(policyRegistry);
  const tenantScope = buildTenantScope(dataGraph);
  const secretRegistry = buildSecretRegistry(input.classified);
  const envSchema = augmentEnvSchemaWithPublicVars(
    buildEnvSchema(secretRegistry),
    input.classified,
  );
  const configRegistry = buildConfigRegistry(secretRegistry);
  const aiRegistry = buildAiRegistry(input.appGraph, input.classified);
  const aiModels = buildAiModels();
  const queryRegistry = buildQueryRegistry(input.appGraph);
  const runtimeGraph = buildRuntimeGraph(input.appGraph);
  const apiSurface = buildApiSurface(runtimeGraph, queryRegistry, workflowRegistry);
  const clientManifest = buildClientManifest(apiSurface, input.classified);
  const devManifest = buildDevManifest(runtimeGraph, queryRegistry, input.appGraph);
  const mockMapEntries = buildMockMapEntries(input.classified);

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
    makeEmitFile(
      `${GENERATED_DIR}/dataGraph.ts`,
      serializeDataGraphTs(dataGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/dataGraph.json`,
      serializeDataGraphJson(dataGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/runtimeGraph.ts`,
      serializeRuntimeGraphTs(runtimeGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/runtimeGraph.json`,
      serializeRuntimeGraphJson(runtimeGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/runtimeRegistry.ts`,
      serializeRuntimeRegistryTs(runtimeGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/mockMap.ts`,
      serializeMockMapTs(mockMapEntries),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/mockMap.json`,
      serializeMockMapJson(mockMapEntries),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/devManifest.ts`,
      serializeDevManifestTs(devManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/devManifest.json`,
      serializeDevManifestJson(devManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/sqlPlan.ts`,
      serializeSqlPlanTsExport(sqlPlan),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/sqlPlan.json`,
      serializeSqlPlanJsonExport(sqlPlan),
    ),
    makeEmitFile(`${GENERATED_DIR}/db.ts`, serializeDbTsExport(sqlPlan, tenantScope)),
    makeEmitFile(`${GENERATED_DIR}/db.json`, serializeDbJsonExport(sqlPlan, tenantScope)),
    makeEmitFile(
      `${GENERATED_DIR}/actionSubscriptions.ts`,
      serializeActionSubscriptionsTs(actionSubscriptions),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/actionSubscriptions.json`,
      serializeActionSubscriptionsJson(actionSubscriptions),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/workflowRegistry.ts`,
      serializeWorkflowRegistryTs(workflowRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/workflowRegistry.json`,
      serializeWorkflowRegistryJson(workflowRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/workflowSubscriptions.ts`,
      serializeWorkflowSubscriptionsTs(workflowSubscriptions),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/workflowSubscriptions.json`,
      serializeWorkflowSubscriptionsJson(workflowSubscriptions),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/telemetryRegistry.ts`,
      serializeTelemetryRegistryTs(telemetryRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/telemetryRegistry.json`,
      serializeTelemetryRegistryJson(telemetryRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/telemetrySinks.ts`,
      serializeTelemetrySinksTs(telemetrySinks),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/telemetrySinks.json`,
      serializeTelemetrySinksJson(telemetrySinks),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/policyRegistry.ts`,
      serializePolicyRegistryTs(policyRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/policyRegistry.json`,
      serializePolicyRegistryJson(policyRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/permissionMatrix.ts`,
      serializePermissionMatrixTs(permissionMatrix),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/permissionMatrix.json`,
      serializePermissionMatrixJson(permissionMatrix),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/tenantScope.ts`,
      serializeTenantScopeTs(tenantScope),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/tenantScope.json`,
      serializeTenantScopeJson(tenantScope),
    ),
    makeEmitFile(`${GENERATED_DIR}/authContext.ts`, serializeAuthContextTs()),
    makeEmitFile(`${GENERATED_DIR}/secretsContext.ts`, serializeSecretsContextTs()),
    makeEmitFile(
      `${GENERATED_DIR}/secretRegistry.ts`,
      serializeSecretRegistryTs(secretRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/secretRegistry.json`,
      serializeSecretRegistryJson(secretRegistry),
    ),
    makeEmitFile(`${GENERATED_DIR}/envSchema.ts`, serializeEnvSchemaTs(envSchema)),
    makeEmitFile(`${GENERATED_DIR}/envSchema.json`, serializeEnvSchemaJson(envSchema)),
    makeEmitFile(
      `${GENERATED_DIR}/configRegistry.ts`,
      serializeConfigRegistryTs(configRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/configRegistry.json`,
      serializeConfigRegistryJson(configRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/aiRegistry.ts`,
      serializeAiRegistryTs(aiRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/aiRegistry.json`,
      serializeAiRegistryJson(aiRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/aiProviders.ts`,
      serializeAiProvidersTs(aiRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/aiProviders.json`,
      serializeAiProvidersJson(aiRegistry),
    ),
    makeEmitFile(`${GENERATED_DIR}/aiModels.ts`, serializeAiModelsTs(aiModels)),
    makeEmitFile(`${GENERATED_DIR}/aiModels.json`, serializeAiModelsJson(aiModels)),
    makeEmitFile(`${GENERATED_DIR}/aiContext.ts`, serializeAiContextTs()),
    makeEmitFile(
      `${GENERATED_DIR}/queryRegistry.ts`,
      serializeQueryRegistryTs(queryRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/queryRegistry.json`,
      serializeQueryRegistryJson(queryRegistry),
    ),
    makeEmitFile(`${GENERATED_DIR}/api.ts`, serializeApiTsExport(apiSurface)),
    makeEmitFile(`${GENERATED_DIR}/api.json`, serializeApiJson(apiSurface)),
    makeEmitFile(`${GENERATED_DIR}/serverApi.ts`, serializeServerApiTsExport(apiSurface)),
    makeEmitFile(`${GENERATED_DIR}/clientApi.ts`, serializeClientApiTsExport(apiSurface)),
    makeEmitFile(`${GENERATED_DIR}/clientTypes.ts`, renderClientTypesTs()),
    makeEmitFile(`${GENERATED_DIR}/client.ts`, renderClientTs()),
    makeEmitFile(`${GENERATED_DIR}/clientManifest.ts`, renderClientManifestTs(clientManifest)),
    makeEmitFile(
      `${GENERATED_DIR}/clientManifest.json`,
      serializeClientManifestJson(clientManifest),
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
