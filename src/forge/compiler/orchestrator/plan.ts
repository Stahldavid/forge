import { buildDataGraph } from "../data-graph/build.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
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
import {
  buildLiveQueryRegistry,
  buildSubscriptionManifest,
} from "../live-query-registry/build.ts";
import { buildApiSurface } from "../api-surface/build.ts";
import {
  buildClientManifest,
  buildReactManifest,
} from "../client-sdk/build-manifest.ts";
import {
  buildFrontendGraph,
  serializeFrontendGraphJson,
  serializeFrontendGraphTs,
} from "../frontend-graph/build.ts";
import {
  renderClientManifestTs,
  renderClientTs,
  renderClientTypesTs,
  renderReactDts,
  renderReactManifestTs,
  renderReactTs,
} from "../client-sdk/render-client.ts";
import { buildSqlPlan } from "../data-graph/sql/ddl.ts";
import { buildRlsArtifacts } from "../data-graph/rls/build.ts";
import { buildGeneratedReleaseArtifacts } from "../release/build.ts";
import { buildLiveProductionArtifacts } from "../live-production/types.ts";
import { buildMakeRegistry, buildMakeTemplates } from "../make-registry/build.ts";
import { buildTestGraph, buildTestPlanRegistry } from "../test-graph/build.ts";
import { buildDevManifest } from "../dev-manifest/build.ts";
import { buildRuntimeGraph } from "../runtime-graph/build.ts";
import {
  buildAgentContractArtifacts,
  serializeAgentToolRegistryJson,
  serializeAgentToolRegistryTs,
  serializeCapabilityMapJson,
  serializeCapabilityMapTs,
  serializeAgentContractJson,
  serializeAgentContractTs,
} from "../agent-contract/build.ts";
import {
  buildAgentAdapterManifest,
  serializeAgentAdapterManifestJson,
  serializeAgentAdapterManifestTs,
} from "../../agent-adapters/index.ts";
import {
  buildUiGeneratedArtifacts,
  serializeUiRoutesJson,
  serializeUiRoutesTs,
  serializeUiScenariosJson,
  serializeUiScenariosTs,
  serializeUiTestManifestJson,
  serializeUiTestManifestTs,
} from "../../ui/index.ts";
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
  serializeRlsPoliciesSql,
  serializeRlsPoliciesJson,
  serializeRlsPoliciesTs,
  serializeDbSecurityManifestJson,
  serializeDbSecurityManifestTs,
  serializeDbSessionContextJson,
  serializeDbSessionContextTs,
  serializePackageUpgradeRegistryJson,
  serializePackageUpgradeRegistryTs,
  serializeReleaseManifestJson,
  serializeReleaseManifestTs,
  serializeDeployManifestJson,
  serializeDeployManifestTs,
  serializeArtifactManifestJson,
  serializeArtifactManifestTs,
  serializeSourceMapManifestJson,
  serializeSourceMapManifestTs,
  serializeSymbolicationManifestJson,
  serializeSymbolicationManifestTs,
  serializeBuildInfoJson,
  serializeBuildInfoTs,
  serializeLiveProductionManifestJson,
  serializeLiveProductionManifestTs,
  serializeLiveProtocolJson,
  serializeLiveProtocolTs,
  serializeLiveTransportConfigJson,
  serializeLiveTransportConfigTs,
  serializeMakeRegistryJson,
  serializeMakeRegistryTs,
  serializeMakeTemplatesJson,
  serializeMakeTemplatesTs,
  serializeTestGraphJson,
  serializeTestGraphTs,
  serializeTestPlanRegistryJson,
  serializeTestPlanRegistryTs,
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
  serializeAuthClaimsJson,
  serializeAuthClaimsTs,
  serializeAuthConfigJson,
  serializeAuthConfigTs,
  serializeAuthContextTs,
  serializeAuthRegistryJson,
  serializeAuthRegistryTs,
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
  serializeLiveQueryRegistryJson,
  serializeLiveQueryRegistryTs,
  serializeSubscriptionManifestJson,
  serializeSubscriptionManifestTs,
  serializeApiJson,
  serializeApiTsExport,
  serializeServerApiTsExport,
  serializeClientApiTsExport,
  serializeClientManifestJson,
  serializeReactManifestJson,
  buildMockMapEntries,
} from "./serialize.ts";
import { buildDefaultAuthRegistry, AUTH_ENV } from "../../runtime/auth/config.ts";
import type { EnvSchema } from "../types/secret-registry.ts";

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
    canonical: path.endsWith(".json"),
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

function augmentEnvSchemaWithAuthVars(schema: EnvSchema): EnvSchema {
  const byName = new Map(schema.variables.map((variable) => [variable.name, variable]));
  for (const name of [
    AUTH_ENV.mode,
    AUTH_ENV.issuer,
    AUTH_ENV.audience,
    AUTH_ENV.jwksUri,
    AUTH_ENV.algorithms,
  ]) {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        kind: "config",
        required: false,
        source: "auth",
      });
    }
  }
  return {
    variables: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
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
  const envSchema = augmentEnvSchemaWithAuthVars(
    augmentEnvSchemaWithPublicVars(
      buildEnvSchema(secretRegistry),
      input.classified,
    ),
  );
  const configRegistry = buildConfigRegistry(secretRegistry);
  const authRegistry = buildDefaultAuthRegistry(tenantScope.tables.length > 0);
  const aiRegistry = buildAiRegistry(input.appGraph, input.classified);
  const aiModels = buildAiModels();
  const queryRegistry = buildQueryRegistry(input.appGraph);
  const liveQueryRegistry = buildLiveQueryRegistry(input.appGraph);
  const subscriptionManifest = buildSubscriptionManifest(liveQueryRegistry);
  const runtimeGraph = buildRuntimeGraph(input.appGraph);
  const apiSurface = buildApiSurface(
    runtimeGraph,
    queryRegistry,
    liveQueryRegistry,
    workflowRegistry,
  );
  const clientManifest = buildClientManifest(apiSurface, input.classified);
  const reactManifest = buildReactManifest(clientManifest);
  const frontendGraph = buildFrontendGraph({
    workspaceRoot: input.ctx.workspaceRoot,
    clientManifest,
  });
  const devManifest = buildDevManifest(runtimeGraph, queryRegistry, input.appGraph);
  const mockMapEntries = buildMockMapEntries(input.classified);
  const agentArtifacts = buildAgentContractArtifacts({
    workspaceRoot: input.ctx.workspaceRoot,
    appGraph: input.appGraph,
    packageGraph: input.packageGraph,
    classified: input.classified,
    runtimeGraph,
    dataGraph,
    policyRegistry,
    permissionMatrix,
    tenantScope,
    secretRegistry,
    telemetryRegistry,
    telemetrySinks,
    aiRegistry,
    queryRegistry,
    liveQueryRegistry,
    workflowRegistry,
    apiSurface,
    clientManifest,
    frontendGraph,
  });
  const agentAdapterManifest = buildAgentAdapterManifest(agentArtifacts.contract);
  const rlsArtifacts = buildRlsArtifacts(sqlPlan, tenantScope);
  const packageUpgradeRegistry = {
    schemaVersion: "0.1.0" as const,
    plannerVersion: GENERATOR_VERSION,
    commands: [
      "forge deps outdated --json",
      "forge deps inspect <package> --json",
      "forge deps diff <package> --to latest --json",
      "forge deps upgrade-plan <package> --to latest",
      "forge deps upgrade-apply <plan>",
      "forge deps upgrade-check --json",
      "forge deps upgrade-rollback <planId>",
    ],
    planDirectory: ".forge/upgrades" as const,
  };
  const releaseArtifacts = buildGeneratedReleaseArtifacts({
    workspaceRoot: input.ctx.workspaceRoot,
    generatedHash: input.ctx.inputFingerprint,
  });
  const liveProductionArtifacts = buildLiveProductionArtifacts(liveQueryRegistry);
  const makeRegistry = buildMakeRegistry(GENERATOR_VERSION);
  const makeTemplates = buildMakeTemplates();
  const testGraph = buildTestGraph({
    workspaceRoot: input.ctx.workspaceRoot,
    inputHash: input.ctx.inputFingerprint,
    appGraph: input.appGraph,
    packageGraph: input.packageGraph,
    sources: input.ctx.sources,
  });
  const testPlanRegistry = buildTestPlanRegistry();
  const uiArtifacts = buildUiGeneratedArtifacts({
    appGraph: input.appGraph,
    apiSurface,
    sources: input.ctx.sources,
  });

  const files: EmitFile[] = [
    makeEmitFile("AGENTS.md", agentArtifacts.agentsMd),
    makeEmitFile(
      `${GENERATED_DIR}/agentContract.ts`,
      serializeAgentContractTs(agentArtifacts.contract),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/agentContract.json`,
      serializeAgentContractJson(agentArtifacts.contract),
    ),
    makeEmitFile(`${GENERATED_DIR}/appMap.md`, agentArtifacts.appMapMd),
    makeEmitFile(
      `${GENERATED_DIR}/agentTools.ts`,
      serializeAgentToolRegistryTs(agentArtifacts.toolRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/agentTools.json`,
      serializeAgentToolRegistryJson(agentArtifacts.toolRegistry),
    ),
    makeEmitFile(`${GENERATED_DIR}/agentTools.md`, agentArtifacts.agentToolsMd),
    makeEmitFile(
      `${GENERATED_DIR}/capabilityMap.ts`,
      serializeCapabilityMapTs(agentArtifacts.capabilityMap),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/capabilityMap.json`,
      serializeCapabilityMapJson(agentArtifacts.capabilityMap),
    ),
    makeEmitFile(`${GENERATED_DIR}/capabilityMap.md`, agentArtifacts.capabilityMapMd),
    makeEmitFile(`${GENERATED_DIR}/runtimeRules.md`, agentArtifacts.runtimeRulesMd),
    makeEmitFile(
      `${GENERATED_DIR}/operationPlaybooks.md`,
      agentArtifacts.operationPlaybooksMd,
    ),
    makeEmitFile(
      `${GENERATED_DIR}/agentQuickstart.md`,
      agentArtifacts.agentQuickstartMd,
    ),
    makeEmitFile(
      `${GENERATED_DIR}/agentAdapterManifest.ts`,
      serializeAgentAdapterManifestTs(agentAdapterManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/agentAdapterManifest.json`,
      serializeAgentAdapterManifestJson(agentAdapterManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/frontendGraph.ts`,
      serializeFrontendGraphTs(frontendGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/frontendGraph.json`,
      serializeFrontendGraphJson(frontendGraph),
    ),
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
      `${GENERATED_DIR}/rlsPolicies.sql`,
      serializeRlsPoliciesSql(rlsArtifacts.policies),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/rlsPolicies.ts`,
      serializeRlsPoliciesTs(rlsArtifacts.policies),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/rlsPolicies.json`,
      serializeRlsPoliciesJson(rlsArtifacts.policies),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/dbSecurityManifest.ts`,
      serializeDbSecurityManifestTs(rlsArtifacts.dbSecurityManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/dbSecurityManifest.json`,
      serializeDbSecurityManifestJson(rlsArtifacts.dbSecurityManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/dbSessionContext.ts`,
      serializeDbSessionContextTs(rlsArtifacts.dbSessionContext),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/dbSessionContext.json`,
      serializeDbSessionContextJson(rlsArtifacts.dbSessionContext),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/packageUpgradeRegistry.ts`,
      serializePackageUpgradeRegistryTs(packageUpgradeRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/packageUpgradeRegistry.json`,
      serializePackageUpgradeRegistryJson(packageUpgradeRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/releaseManifest.ts`,
      serializeReleaseManifestTs(releaseArtifacts.releaseManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/releaseManifest.json`,
      serializeReleaseManifestJson(releaseArtifacts.releaseManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/deployManifest.ts`,
      serializeDeployManifestTs(releaseArtifacts.deployManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/deployManifest.json`,
      serializeDeployManifestJson(releaseArtifacts.deployManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/artifactManifest.ts`,
      serializeArtifactManifestTs(releaseArtifacts.artifactManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/artifactManifest.json`,
      serializeArtifactManifestJson(releaseArtifacts.artifactManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/sourceMapManifest.ts`,
      serializeSourceMapManifestTs(releaseArtifacts.sourceMapManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/sourceMapManifest.json`,
      serializeSourceMapManifestJson(releaseArtifacts.sourceMapManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/symbolicationManifest.ts`,
      serializeSymbolicationManifestTs(releaseArtifacts.symbolicationManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/symbolicationManifest.json`,
      serializeSymbolicationManifestJson(releaseArtifacts.symbolicationManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/buildInfo.ts`,
      serializeBuildInfoTs(releaseArtifacts.buildInfo),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/buildInfo.json`,
      serializeBuildInfoJson(releaseArtifacts.buildInfo),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveProductionManifest.ts`,
      serializeLiveProductionManifestTs(liveProductionArtifacts.liveProductionManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveProductionManifest.json`,
      serializeLiveProductionManifestJson(liveProductionArtifacts.liveProductionManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveProtocol.ts`,
      serializeLiveProtocolTs(liveProductionArtifacts.liveProtocol),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveProtocol.json`,
      serializeLiveProtocolJson(liveProductionArtifacts.liveProtocol),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveTransportConfig.ts`,
      serializeLiveTransportConfigTs(liveProductionArtifacts.liveTransportConfig),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveTransportConfig.json`,
      serializeLiveTransportConfigJson(liveProductionArtifacts.liveTransportConfig),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/makeRegistry.ts`,
      serializeMakeRegistryTs(makeRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/makeRegistry.json`,
      serializeMakeRegistryJson(makeRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/makeTemplates.ts`,
      serializeMakeTemplatesTs(makeTemplates),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/makeTemplates.json`,
      serializeMakeTemplatesJson(makeTemplates),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/testGraph.ts`,
      serializeTestGraphTs(testGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/testGraph.json`,
      serializeTestGraphJson(testGraph),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/testPlanRegistry.ts`,
      serializeTestPlanRegistryTs(testPlanRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/testPlanRegistry.json`,
      serializeTestPlanRegistryJson(testPlanRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiTestManifest.ts`,
      serializeUiTestManifestTs(uiArtifacts.manifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiTestManifest.json`,
      serializeUiTestManifestJson(uiArtifacts.manifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiScenarios.ts`,
      serializeUiScenariosTs(uiArtifacts.scenarios),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiScenarios.json`,
      serializeUiScenariosJson(uiArtifacts.scenarios),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiRoutes.ts`,
      serializeUiRoutesTs(uiArtifacts.routes),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/uiRoutes.json`,
      serializeUiRoutesJson(uiArtifacts.routes),
    ),
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
    makeEmitFile(
      `${GENERATED_DIR}/authRegistry.ts`,
      serializeAuthRegistryTs(authRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/authRegistry.json`,
      serializeAuthRegistryJson(authRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/authConfig.ts`,
      serializeAuthConfigTs(authRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/authConfig.json`,
      serializeAuthConfigJson(authRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/authClaims.ts`,
      serializeAuthClaimsTs(authRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/authClaims.json`,
      serializeAuthClaimsJson(authRegistry),
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
    makeEmitFile(
      `${GENERATED_DIR}/liveQueryRegistry.ts`,
      serializeLiveQueryRegistryTs(liveQueryRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/liveQueryRegistry.json`,
      serializeLiveQueryRegistryJson(liveQueryRegistry),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/subscriptionManifest.ts`,
      serializeSubscriptionManifestTs(subscriptionManifest),
    ),
    makeEmitFile(
      `${GENERATED_DIR}/subscriptionManifest.json`,
      serializeSubscriptionManifestJson(subscriptionManifest),
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
    makeEmitFile(`${GENERATED_DIR}/react.ts`, renderReactTs()),
    makeEmitFile(`${GENERATED_DIR}/react.d.ts`, renderReactDts()),
    makeEmitFile(`${GENERATED_DIR}/reactManifest.ts`, renderReactManifestTs(reactManifest)),
    makeEmitFile(
      `${GENERATED_DIR}/reactManifest.json`,
      serializeReactManifestJson(reactManifest),
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
    diagnostics: [
      ...agentArtifacts.diagnostics,
      ...rlsArtifacts.diagnostics,
      ...frontendGraph.diagnostics.map((diagnostic) =>
        createDiagnostic({
          severity: diagnostic.severity,
          code: diagnostic.code,
          message: diagnostic.message,
          ...(diagnostic.file ? { file: diagnostic.file } : {}),
        }),
      ),
    ],
  };
}
