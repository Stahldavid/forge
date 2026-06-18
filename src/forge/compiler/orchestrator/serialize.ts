import type { AppGraph } from "../types/app-graph.ts";
import type { DataGraph } from "../types/data-graph.ts";
import type { PackageGraph } from "../types/package-graph.ts";
import type { RuntimeMatrix } from "../types/runtime-matrix.ts";
import type { ImportGuardsArtifact } from "../types/import-guards.ts";
import type { DevManifest } from "../types/dev-manifest.ts";
import type { ActionSubscriptions } from "../types/action-subscriptions.ts";
import type {
  WorkflowRegistry,
  WorkflowSubscriptions,
} from "../types/workflow-registry.ts";
import type {
  TelemetryRegistry,
  TelemetrySinks,
} from "../types/telemetry-registry.ts";
import type {
  PermissionMatrix,
  PolicyRegistry,
  TenantScope,
} from "../types/policy-registry.ts";
import type { MockMapEntry, RuntimeGraph } from "../types/runtime-graph.ts";
import type { QueryRegistry } from "../types/query-registry.ts";
import type {
  LiveQueryRegistry,
  SubscriptionManifest,
} from "../types/live-query-registry.ts";
import type { ApiSurface } from "../api-surface/build.ts";
import {
  serializeApiTs,
  serializeClientApiTs,
  serializeServerApiTs,
} from "../api-surface/build.ts";
import type { SqlPlan } from "../data-graph/sql/types.ts";
import {
  serializeDbJson,
  serializeDbTs,
  serializeSqlPlanJson,
  serializeSqlPlanTs,
} from "../data-graph/sql/serialize.ts";
import type {
  DbSecurityManifest,
  DbSessionContextArtifact,
  RlsPoliciesArtifact,
} from "../data-graph/rls/types.ts";
import type { PackageUpgradeRegistry } from "../package-upgrades/types.ts";
import type {
  ArtifactManifest,
  BuildInfo,
  DeployManifest,
  ReleaseManifest,
  SourceMapManifest,
  SymbolicationManifest,
} from "../release/types.ts";
import type {
  LiveProductionManifest,
  LiveProtocolManifest,
  LiveTransportConfig,
} from "../live-production/types.ts";
import type {
  MakeRegistryArtifact,
  MakeTemplateArtifact,
} from "../make-registry/build.ts";
import type { TestGraph, TestPlanRegistry } from "../types/test-graph.ts";
import {
  serializeMakeRegistryJson as serializeMakeRegistryJsonArtifact,
  serializeMakeRegistryTs as serializeMakeRegistryTsArtifact,
  serializeMakeTemplatesJson as serializeMakeTemplatesJsonArtifact,
  serializeMakeTemplatesTs as serializeMakeTemplatesTsArtifact,
} from "../make-registry/build.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import { GENERATED_DIR } from "../emitter/constants.ts";
import { serializeCanonical } from "../primitives/serialize.ts";
import { buildImportGuardsArtifact } from "../guards/artifacts.ts";
import type { AuthRegistryArtifact } from "../../runtime/auth/config.ts";

function moduleGraphForAppGraphSnapshot(graph: AppGraph): AppGraph["moduleGraph"] {
  return {
    nodes: graph.moduleGraph.nodes.map((node) => ({
      ...node,
      directPackageImports: [...node.directPackageImports],
      localImports: [...node.localImports],
      declaredContexts: [...node.declaredContexts],
      effectiveContexts: [],
    })),
  };
}

export function serializeConstFromJson(
  exportName: string,
  serializedJson: string,
): string {
  const parsed: unknown = JSON.parse(serializedJson.trimEnd());
  return `export const ${exportName} = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAppGraphJson(graph: AppGraph): string {
  const payload = {
    schemaVersion: graph.schemaVersion,
    generatorVersion: graph.generatorVersion,
    analyzerVersion: graph.analyzerVersion,
    inputHash: graph.inputHash,
    symbols: graph.symbols,
    edges: graph.edges,
    moduleGraph: moduleGraphForAppGraphSnapshot(graph),
  };
  return serializeCanonical(payload);
}

export function serializeAppGraphTs(graph: AppGraph): string {
  return serializeConstFromJson("appGraph", serializeAppGraphJson(graph));
}

export function serializePackageGraphJson(graph: PackageGraph): string {
  return serializeCanonical(graph);
}

export function serializePackageGraphTs(graph: PackageGraph): string {
  return serializeConstFromJson("packageGraph", serializePackageGraphJson(graph));
}

export function serializeRuntimeMatrixJson(matrix: RuntimeMatrix): string {
  return serializeCanonical(matrix);
}

export function serializeRuntimeMatrixTs(matrix: RuntimeMatrix): string {
  return serializeConstFromJson("runtimeMatrix", serializeRuntimeMatrixJson(matrix));
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

export function serializeSqlPlanJsonExport(plan: SqlPlan): string {
  return serializeSqlPlanJson(plan);
}

export function serializeSqlPlanTsExport(plan: SqlPlan): string {
  return serializeSqlPlanTs(plan);
}

export function serializeDbJsonExport(plan: SqlPlan, tenantScope?: TenantScope): string {
  return serializeDbJson(plan, tenantScope);
}

export function serializeDbTsExport(plan: SqlPlan, tenantScope?: TenantScope): string {
  return serializeDbTs(plan, tenantScope);
}

export function serializeRlsPoliciesSql(artifact: RlsPoliciesArtifact): string {
  return artifact.sql;
}

export function serializeRlsPoliciesJson(artifact: RlsPoliciesArtifact): string {
  return serializeCanonical({
    schemaVersion: artifact.schemaVersion,
    tables: artifact.tables,
    diagnostics: artifact.diagnostics,
  });
}

export function serializeRlsPoliciesTs(artifact: RlsPoliciesArtifact): string {
  const parsed: unknown = JSON.parse(serializeRlsPoliciesJson(artifact).trimEnd());
  return `export const rlsPolicies = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeDbSecurityManifestJson(manifest: DbSecurityManifest): string {
  return serializeCanonical(manifest);
}

export function serializeDbSecurityManifestTs(manifest: DbSecurityManifest): string {
  const parsed: unknown = JSON.parse(
    serializeDbSecurityManifestJson(manifest).trimEnd(),
  );
  return `export const dbSecurityManifest = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeDbSessionContextJson(context: DbSessionContextArtifact): string {
  return serializeCanonical(context);
}

export function serializeDbSessionContextTs(context: DbSessionContextArtifact): string {
  const parsed: unknown = JSON.parse(serializeDbSessionContextJson(context).trimEnd());
  return `export const dbSessionContext = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializePackageUpgradeRegistryJson(
  registry: PackageUpgradeRegistry,
): string {
  return serializeCanonical(registry);
}

export function serializePackageUpgradeRegistryTs(registry: PackageUpgradeRegistry): string {
  const parsed: unknown = JSON.parse(
    serializePackageUpgradeRegistryJson(registry).trimEnd(),
  );
  return `export const packageUpgradeRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

function tsConst(name: string, value: unknown): string {
  return `export const ${name} = ${JSON.stringify(value, null, 2)} as const;\n`;
}

export function serializeReleaseManifestJson(manifest: ReleaseManifest): string {
  return serializeCanonical(manifest);
}

export function serializeReleaseManifestTs(manifest: ReleaseManifest): string {
  return tsConst("releaseManifest", JSON.parse(serializeReleaseManifestJson(manifest)));
}

export function serializeDeployManifestJson(manifest: DeployManifest): string {
  return serializeCanonical(manifest);
}

export function serializeDeployManifestTs(manifest: DeployManifest): string {
  return tsConst("deployManifest", JSON.parse(serializeDeployManifestJson(manifest)));
}

export function serializeArtifactManifestJson(manifest: ArtifactManifest): string {
  return serializeCanonical(manifest);
}

export function serializeArtifactManifestTs(manifest: ArtifactManifest): string {
  return tsConst("artifactManifest", JSON.parse(serializeArtifactManifestJson(manifest)));
}

export function serializeSourceMapManifestJson(manifest: SourceMapManifest): string {
  return serializeCanonical(manifest);
}

export function serializeSourceMapManifestTs(manifest: SourceMapManifest): string {
  return tsConst("sourceMapManifest", JSON.parse(serializeSourceMapManifestJson(manifest)));
}

export function serializeSymbolicationManifestJson(manifest: SymbolicationManifest): string {
  return serializeCanonical(manifest);
}

export function serializeSymbolicationManifestTs(manifest: SymbolicationManifest): string {
  return tsConst(
    "symbolicationManifest",
    JSON.parse(serializeSymbolicationManifestJson(manifest)),
  );
}

export function serializeBuildInfoJson(info: BuildInfo): string {
  return serializeCanonical(info);
}

export function serializeBuildInfoTs(info: BuildInfo): string {
  return tsConst("buildInfo", JSON.parse(serializeBuildInfoJson(info)));
}

export function serializeLiveProductionManifestJson(
  manifest: LiveProductionManifest,
): string {
  return serializeCanonical(manifest);
}

export function serializeLiveProductionManifestTs(
  manifest: LiveProductionManifest,
): string {
  return tsConst(
    "liveProductionManifest",
    JSON.parse(serializeLiveProductionManifestJson(manifest)),
  );
}

export function serializeLiveProtocolJson(manifest: LiveProtocolManifest): string {
  return serializeCanonical(manifest);
}

export function serializeLiveProtocolTs(manifest: LiveProtocolManifest): string {
  return tsConst("liveProtocol", JSON.parse(serializeLiveProtocolJson(manifest)));
}

export function serializeLiveTransportConfigJson(
  config: LiveTransportConfig,
): string {
  return serializeCanonical(config);
}

export function serializeLiveTransportConfigTs(config: LiveTransportConfig): string {
  return tsConst(
    "liveTransportConfig",
    JSON.parse(serializeLiveTransportConfigJson(config)),
  );
}

export function serializeMakeRegistryJson(registry: MakeRegistryArtifact): string {
  return serializeMakeRegistryJsonArtifact(registry);
}

export function serializeMakeRegistryTs(registry: MakeRegistryArtifact): string {
  return serializeMakeRegistryTsArtifact(registry);
}

export function serializeMakeTemplatesJson(templates: MakeTemplateArtifact): string {
  return serializeMakeTemplatesJsonArtifact(templates);
}

export function serializeMakeTemplatesTs(templates: MakeTemplateArtifact): string {
  return serializeMakeTemplatesTsArtifact(templates);
}

export function serializeActionSubscriptionsJson(
  subscriptions: ActionSubscriptions,
): string {
  const payload = {
    schemaVersion: subscriptions.schemaVersion,
    generatorVersion: subscriptions.generatorVersion,
    analyzerVersion: subscriptions.analyzerVersion,
    inputHash: subscriptions.inputHash,
    subscriptions: subscriptions.subscriptions,
    byEvent: subscriptions.byEvent,
    diagnostics: subscriptions.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeActionSubscriptionsTs(
  subscriptions: ActionSubscriptions,
): string {
  const parsed: unknown = JSON.parse(
    serializeActionSubscriptionsJson(subscriptions).trimEnd(),
  );
  return `export const actionSubscriptions = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeWorkflowRegistryJson(registry: WorkflowRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    workflows: registry.workflows,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeWorkflowRegistryTs(registry: WorkflowRegistry): string {
  const parsed: unknown = JSON.parse(
    serializeWorkflowRegistryJson(registry).trimEnd(),
  );
  return `export const workflowRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeWorkflowSubscriptionsJson(
  subscriptions: WorkflowSubscriptions,
): string {
  const payload = {
    schemaVersion: subscriptions.schemaVersion,
    generatorVersion: subscriptions.generatorVersion,
    analyzerVersion: subscriptions.analyzerVersion,
    inputHash: subscriptions.inputHash,
    subscriptions: subscriptions.subscriptions,
    byEvent: subscriptions.byEvent,
    diagnostics: subscriptions.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeWorkflowSubscriptionsTs(
  subscriptions: WorkflowSubscriptions,
): string {
  const parsed: unknown = JSON.parse(
    serializeWorkflowSubscriptionsJson(subscriptions).trimEnd(),
  );
  return `export const workflowSubscriptions = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeTelemetryRegistryJson(registry: TelemetryRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    events: registry.events,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeTelemetryRegistryTs(registry: TelemetryRegistry): string {
  const parsed: unknown = JSON.parse(
    serializeTelemetryRegistryJson(registry).trimEnd(),
  );
  return `export const telemetryRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeTelemetrySinksJson(sinks: TelemetrySinks): string {
  return serializeCanonical(sinks);
}

export function serializeTelemetrySinksTs(sinks: TelemetrySinks): string {
  const parsed: unknown = JSON.parse(serializeTelemetrySinksJson(sinks).trimEnd());
  return `export const telemetrySinks = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializePolicyRegistryJson(registry: PolicyRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    policies: registry.policies,
    commandAuth: registry.commandAuth,
    queryAuth: registry.queryAuth,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializePolicyRegistryTs(registry: PolicyRegistry): string {
  const parsed: unknown = JSON.parse(serializePolicyRegistryJson(registry).trimEnd());
  return `export const policyRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializePermissionMatrixJson(matrix: PermissionMatrix): string {
  const payload = {
    schemaVersion: matrix.schemaVersion,
    generatorVersion: matrix.generatorVersion,
    inputHash: matrix.inputHash,
    entries: matrix.entries,
  };
  return serializeCanonical(payload);
}

export function serializePermissionMatrixTs(matrix: PermissionMatrix): string {
  const parsed: unknown = JSON.parse(serializePermissionMatrixJson(matrix).trimEnd());
  return `export const permissionMatrix = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeTenantScopeJson(scope: TenantScope): string {
  const payload = {
    schemaVersion: scope.schemaVersion,
    generatorVersion: scope.generatorVersion,
    inputHash: scope.inputHash,
    tables: scope.tables,
    diagnostics: scope.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeTenantScopeTs(scope: TenantScope): string {
  const parsed: unknown = JSON.parse(serializeTenantScopeJson(scope).trimEnd());
  return `export const tenantScope = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAuthRegistryJson(registry: AuthRegistryArtifact): string {
  return serializeCanonical(registry);
}

export function serializeAuthRegistryTs(registry: AuthRegistryArtifact): string {
  const parsed: unknown = JSON.parse(serializeAuthRegistryJson(registry).trimEnd());
  return `export const authRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAuthConfigJson(registry: AuthRegistryArtifact): string {
  return serializeCanonical({
    schemaVersion: registry.schemaVersion,
    modeEnv: "FORGE_AUTH_MODE",
    defaultMode: registry.defaultMode,
    modes: registry.modes,
    issuerEnv: registry.issuerEnv,
    audienceEnv: registry.audienceEnv,
    jwksUriEnv: registry.jwksUriEnv,
    algorithmsEnv: registry.algorithmsEnv,
    requiresTenant: registry.requiresTenant,
  });
}

export function serializeAuthConfigTs(registry: AuthRegistryArtifact): string {
  const parsed: unknown = JSON.parse(serializeAuthConfigJson(registry).trimEnd());
  return `export const authConfig = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAuthClaimsJson(registry: AuthRegistryArtifact): string {
  return serializeCanonical({
    schemaVersion: registry.schemaVersion,
    claims: registry.claims,
  });
}

export function serializeAuthClaimsTs(registry: AuthRegistryArtifact): string {
  const parsed: unknown = JSON.parse(serializeAuthClaimsJson(registry).trimEnd());
  return `export const authClaims = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAuthContextTs(): string {
  return `export type AuthContext =
  | {
      kind: "user";
      userId: string;
      tenantId?: string;
      role?: string;
      roles?: string[];
      permissions?: string[];
      email?: string;
      name?: string;
      token?: {
        issuer: string;
        audience: string | string[];
        subject: string;
        expiresAt?: number;
        issuedAt?: number;
        authProvider: string;
      };
      claims?: Record<string, unknown>;
    }
  | { kind: "system"; tenantId?: string; triggeredBy?: AuthContext }
  | { kind: "anonymous" };
`;
}

export function serializeSecretsContextTs(): string {
  return `export interface SecretsContext {
  get(name: string): string;
  optional(name: string): string | undefined;
  has(name: string): boolean;
}

export interface ConfigContext {
  get(name: string): string;
  optional(name: string): string | undefined;
}
`;
}

export function serializeSecretRegistryJson(registry: import("../types/secret-registry.ts").SecretRegistry): string {
  return serializeCanonical({ secrets: registry.secrets });
}

export function serializeSecretRegistryTs(registry: import("../types/secret-registry.ts").SecretRegistry): string {
  const parsed: unknown = JSON.parse(serializeSecretRegistryJson(registry).trimEnd());
  return `export const secretRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeEnvSchemaJson(schema: import("../types/secret-registry.ts").EnvSchema): string {
  return serializeCanonical({ variables: schema.variables });
}

export function serializeEnvSchemaTs(schema: import("../types/secret-registry.ts").EnvSchema): string {
  const parsed: unknown = JSON.parse(serializeEnvSchemaJson(schema).trimEnd());
  return `export const envSchema = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeConfigRegistryJson(registry: import("../types/secret-registry.ts").ConfigRegistry): string {
  return serializeCanonical({ configs: registry.configs });
}

export function serializeConfigRegistryTs(registry: import("../types/secret-registry.ts").ConfigRegistry): string {
  const parsed: unknown = JSON.parse(serializeConfigRegistryJson(registry).trimEnd());
  return `export const configRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAiRegistryJson(registry: import("../types/ai-registry.ts").AiRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    providers: registry.providers,
    generations: registry.generations,
    tools: registry.tools,
    agents: registry.agents,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeAiRegistryTs(registry: import("../types/ai-registry.ts").AiRegistry): string {
  const parsed: unknown = JSON.parse(serializeAiRegistryJson(registry).trimEnd());
  return `export const aiRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAiProvidersJson(registry: import("../types/ai-registry.ts").AiRegistry): string {
  return serializeCanonical({ providers: registry.providers });
}

export function serializeAiProvidersTs(registry: import("../types/ai-registry.ts").AiRegistry): string {
  const parsed: unknown = JSON.parse(serializeAiProvidersJson(registry).trimEnd());
  return `export const aiProviders = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAiModelsJson(models: import("../types/ai-registry.ts").AiModelDefinition[]): string {
  return serializeCanonical({ models });
}

export function serializeAiModelsTs(models: import("../types/ai-registry.ts").AiModelDefinition[]): string {
  const parsed: unknown = JSON.parse(serializeAiModelsJson(models).trimEnd());
  return `export const aiModels = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeAiContextTs(): string {
  return `export type ForgeAiProvider = "openai" | "anthropic" | "gateway";

export type ForgeFlexibleSchema<T> = unknown & {
  readonly __forgeStructuredOutput?: T;
};

export interface ForgeAiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ForgeGenerateTextInput {
  provider: ForgeAiProvider;
  model: string;
  prompt: string;
  system?: string;
  purpose?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ForgeGenerateTextResult {
  text: string;
  provider: ForgeAiProvider;
  model: string;
  purpose?: string;
  usage: ForgeAiUsage;
  latencyMs: number;
  estimatedCostUsd?: number;
}

export interface ForgeStreamTextInput extends ForgeGenerateTextInput {}

export interface ForgeStreamTextResult {
  textStream: AsyncIterable<string>;
  text: Promise<string>;
  provider: ForgeAiProvider;
  model: string;
  purpose?: string;
  usage: Promise<ForgeAiUsage>;
  latencyMs: number;
}

export interface ForgeGenerateStructuredInput<T> {
  provider: ForgeAiProvider;
  model: string;
  prompt: string;
  system?: string;
  purpose?: string;
  schema: ForgeFlexibleSchema<T>;
}

export type ForgeAiToolRisk = "read" | "write" | "external" | "destructive";

export interface ForgeAiToolRuntimeContext {
  secrets: {
    get(name: string): string;
    optional(name: string): string | undefined;
    has(name: string): boolean;
  };
  env: Record<string, string | undefined>;
  telemetry?: {
    traceId?: string;
    capture(name: string, properties?: Record<string, unknown>): Promise<void>;
  };
  auth?: unknown;
}

export interface ForgeAiToolDefinition<TArgs = unknown, TResult = unknown> {
  description: string;
  inputSchema: unknown;
  outputSchema?: unknown;
  strict?: boolean;
  needsApproval?: boolean | ((args: TArgs) => boolean | Promise<boolean>);
  risk?: ForgeAiToolRisk;
  handler: (
    ctx: ForgeAiToolRuntimeContext,
    args: TArgs,
  ) => TResult | Promise<TResult>;
}

export type ForgeAgentStopWhen =
  | { kind: "stepCount"; maxSteps: number }
  | { kind: "toolCall"; toolName: string };

export interface ForgeRunAgentInput {
  provider?: ForgeAiProvider;
  model: string;
  prompt: string;
  instructions: string;
  purpose?: string;
  tools?: Record<string, ForgeAiToolDefinition>;
  stopWhen?: ForgeAgentStopWhen;
  maxSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

export interface ForgeRunAgentResult {
  text: string;
  provider: ForgeAiProvider;
  model: string;
  purpose?: string;
  usage: ForgeAiUsage;
  latencyMs: number;
  toolCalls: Array<{
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolName: string;
    output: unknown;
  }>;
  steps: number;
  estimatedCostUsd?: number;
}

export interface AiContext {
  generateText(input: ForgeGenerateTextInput): Promise<ForgeGenerateTextResult>;
  streamText(input: ForgeStreamTextInput): Promise<ForgeStreamTextResult>;
  generateStructured<T>(input: ForgeGenerateStructuredInput<T>): Promise<T>;
  runAgent(input: ForgeRunAgentInput): Promise<ForgeRunAgentResult>;
}
`;
}

export function serializeQueryRegistryJson(registry: QueryRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    queries: registry.queries,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeQueryRegistryTs(registry: QueryRegistry): string {
  const parsed: unknown = JSON.parse(serializeQueryRegistryJson(registry).trimEnd());
  return `export const queryRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeLiveQueryRegistryJson(registry: LiveQueryRegistry): string {
  const payload = {
    schemaVersion: registry.schemaVersion,
    generatorVersion: registry.generatorVersion,
    analyzerVersion: registry.analyzerVersion,
    inputHash: registry.inputHash,
    liveQueries: registry.liveQueries,
    diagnostics: registry.diagnostics,
  };
  return serializeCanonical(payload);
}

export function serializeLiveQueryRegistryTs(registry: LiveQueryRegistry): string {
  const parsed: unknown = JSON.parse(
    serializeLiveQueryRegistryJson(registry).trimEnd(),
  );
  return `export const liveQueryRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeSubscriptionManifestJson(
  manifest: SubscriptionManifest,
): string {
  return serializeCanonical(manifest);
}

export function serializeSubscriptionManifestTs(
  manifest: SubscriptionManifest,
): string {
  const parsed: unknown = JSON.parse(
    serializeSubscriptionManifestJson(manifest).trimEnd(),
  );
  return `export const subscriptionManifest = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeApiJson(surface: ApiSurface): string {
  const external = surface.external ?? { services: {}, commands: {}, queries: {} };
  return serializeCanonical({
    schemaVersion: surface.schemaVersion,
    generatorVersion: surface.generatorVersion,
    inputHash: surface.inputHash,
    queries: surface.queries,
    commands: surface.commands,
    liveQueries: surface.liveQueries,
    actions: surface.actions,
    workflows: surface.workflows,
    external,
  });
}

export function serializeApiTsExport(surface: ApiSurface): string {
  return serializeApiTs(surface);
}

export function serializeServerApiTsExport(surface: ApiSurface): string {
  return serializeServerApiTs(surface);
}

export function serializeClientApiTsExport(surface: ApiSurface): string {
  return serializeClientApiTs(surface);
}

export function serializeClientManifestJson(
  manifest: import("../client-sdk/build-manifest.ts").ClientManifest,
): string {
  return serializeCanonical(manifest);
}

export function serializeClientManifestTs(
  manifest: import("../client-sdk/build-manifest.ts").ClientManifest,
): string {
  const parsed: unknown = JSON.parse(serializeClientManifestJson(manifest).trimEnd());
  return `export const clientManifest = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeReactManifestJson(
  manifest: import("../client-sdk/build-manifest.ts").ReactManifest,
): string {
  return serializeCanonical(manifest);
}

export function serializeVueManifestJson(
  manifest: import("../client-sdk/build-manifest.ts").VueManifest,
): string {
  return serializeCanonical(manifest);
}

export function serializeTestGraphJson(graph: TestGraph): string {
  return serializeCanonical(graph);
}

export function serializeTestGraphTs(graph: TestGraph): string {
  const parsed: unknown = JSON.parse(serializeTestGraphJson(graph).trimEnd());
  return `export const testGraph = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeTestPlanRegistryJson(registry: TestPlanRegistry): string {
  return serializeCanonical(registry);
}

export function serializeTestPlanRegistryTs(registry: TestPlanRegistry): string {
  const parsed: unknown = JSON.parse(serializeTestPlanRegistryJson(registry).trimEnd());
  return `export const testPlanRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export type { ImportGuardsArtifact };
