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
import type { SqlPlan } from "../data-graph/sql/types.ts";
import {
  serializeDbJson,
  serializeDbTs,
  serializeSqlPlanJson,
  serializeSqlPlanTs,
} from "../data-graph/sql/serialize.ts";
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

export function serializeAuthContextTs(): string {
  return `export type AuthContext =
  | { kind: "user"; userId: string; tenantId: string; role: string; permissions?: string[] }
  | { kind: "system"; tenantId?: string; triggeredBy?: { userId?: string; tenantId?: string; role?: string } }
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
  schema: unknown;
}

export interface AiContext {
  generateText(input: ForgeGenerateTextInput): Promise<ForgeGenerateTextResult>;
  streamText(input: ForgeStreamTextInput): Promise<ForgeStreamTextResult>;
  generateStructured<T>(input: ForgeGenerateStructuredInput<T>): Promise<T>;
}
`;
}

export type { ImportGuardsArtifact };
