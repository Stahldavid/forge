import { GENERATOR_VERSION } from "../emitter/constants.ts";
import { hashStable } from "../primitives/hash.ts";
import { canonicalJson } from "../primitives/serialize.ts";
import type { AppGraph } from "../types/app-graph.ts";
import type {
  AiGenerationCall,
  AiAgentDefinition,
  AiModelDefinition,
  AiProviderDefinition,
  AiRegistry,
  AiToolDefinition,
  ForgeAiProvider,
} from "../types/ai-registry.ts";
import type { ClassifiedPackage } from "../classifier/runtime-matrix.ts";
import { resolveByPackageName } from "../recipes/registry.ts";
import {
  AI_REGISTRY_ANALYZER_VERSION,
  AI_REGISTRY_SCHEMA_VERSION,
} from "./constants.ts";
import {
  parseAiAgentMeta,
  parseAiCallsFromSlice,
  parseAiToolMeta,
} from "./parse.ts";

const KNOWN_MODELS: AiModelDefinition[] = [
  {
    provider: "openai",
    model: "gpt-5.4",
  },
  {
    provider: "openai",
    model: "gpt-4o",
    inputCostPer1kTokensUsd: 0.0025,
    outputCostPer1kTokensUsd: 0.01,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    inputCostPer1kTokensUsd: 0.00015,
    outputCostPer1kTokensUsd: 0.0006,
  },
  {
    provider: "anthropic",
    model: "claude-sonnet-4.5",
  },
  {
    provider: "anthropic",
    model: "claude-3-5-sonnet-20241022",
    inputCostPer1kTokensUsd: 0.003,
    outputCostPer1kTokensUsd: 0.015,
  },
  {
    provider: "anthropic",
    model: "claude-3-5-haiku-20241022",
    inputCostPer1kTokensUsd: 0.0008,
    outputCostPer1kTokensUsd: 0.004,
  },
  {
    provider: "gateway",
    model: "openai/gpt-5.4",
  },
  {
    provider: "gateway",
    model: "anthropic/claude-sonnet-4.5",
  },
  {
    provider: "gateway",
    model: "openai/gpt-4o",
    inputCostPer1kTokensUsd: 0.0025,
    outputCostPer1kTokensUsd: 0.01,
  },
];

function buildProviders(classified: ClassifiedPackage[]): AiProviderDefinition[] {
  const providers = new Map<ForgeAiProvider, AiProviderDefinition>();

  for (const pkg of classified) {
    const recipe = pkg.recipe ?? resolveByPackageName(pkg.api.name);
    if (!recipe) continue;

    const alias = recipe.alias;
    if (alias === "ai-provider-openai" || alias === "@ai-sdk/openai") {
      providers.set("openai", {
        id: "openai",
        packageName: "@ai-sdk/openai",
        secretName: "OPENAI_API_KEY",
        integration: "ai-provider-openai",
      });
    }
    if (alias === "ai-provider-anthropic" || alias === "@ai-sdk/anthropic") {
      providers.set("anthropic", {
        id: "anthropic",
        packageName: "@ai-sdk/anthropic",
        secretName: "ANTHROPIC_API_KEY",
        integration: "ai-provider-anthropic",
      });
    }
    if (alias === "ai-gateway" || alias === "ai") {
      providers.set("gateway", {
        id: "gateway",
        packageName: "ai",
        secretName: "AI_GATEWAY_API_KEY",
        integration: "ai-gateway",
      });
    }
  }

  if (providers.size === 0) {
    return [
      {
        id: "openai",
        packageName: "@ai-sdk/openai",
        secretName: "OPENAI_API_KEY",
        integration: "ai-provider-openai",
      },
      {
        id: "anthropic",
        packageName: "@ai-sdk/anthropic",
        secretName: "ANTHROPIC_API_KEY",
        integration: "ai-provider-anthropic",
      },
      {
        id: "gateway",
        packageName: "ai",
        secretName: "AI_GATEWAY_API_KEY",
        integration: "ai-gateway",
      },
    ];
  }

  return [...providers.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function buildAiModels(): AiModelDefinition[] {
  return [...KNOWN_MODELS].sort((a, b) =>
    a.provider === b.provider
      ? a.model.localeCompare(b.model)
      : a.provider.localeCompare(b.provider),
  );
}

export function buildAiRegistry(
  appGraph: AppGraph,
  classified: ClassifiedPackage[],
): AiRegistry {
  const generations: AiGenerationCall[] = [];
  const tools: AiToolDefinition[] = [];
  const agents: AiAgentDefinition[] = [];

  for (const symbol of appGraph.symbols) {
    const sourceSlice =
      typeof symbol.meta.sourceSlice === "string" ? symbol.meta.sourceSlice : "";
    if (sourceSlice.length === 0) continue;

    if (symbol.kind === "aiTool") {
      const meta = parseAiToolMeta(sourceSlice);
      tools.push({
        name: symbol.name,
        file: symbol.file,
        ...(meta.description ? { description: meta.description } : {}),
        risk: meta.risk,
        strict: meta.strict,
        needsApproval: meta.needsApproval,
      });
    }

    if (symbol.kind === "agent") {
      const meta = parseAiAgentMeta(sourceSlice);
      agents.push({
        name: symbol.name,
        file: symbol.file,
        provider: meta.provider ?? "gateway",
        model: meta.model ?? "unknown",
        ...(meta.instructions ? { instructions: meta.instructions } : {}),
        tools: meta.tools,
        stopWhen: meta.stopWhen,
      });
    }

    for (const call of parseAiCallsFromSlice(sourceSlice)) {
      generations.push({
        provider: call.provider ?? "openai",
        model: call.model ?? "unknown",
        purpose: call.purpose,
        method: call.method,
        file: symbol.file,
      });
    }
  }

  generations.sort((a, b) => {
    const fileCmp = a.file.localeCompare(b.file);
    if (fileCmp !== 0) return fileCmp;
    return a.method.localeCompare(b.method);
  });
  tools.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.file.localeCompare(b.file);
  });
  agents.sort((a, b) => {
    const nameCmp = a.name.localeCompare(b.name);
    if (nameCmp !== 0) return nameCmp;
    return a.file.localeCompare(b.file);
  });

  return {
    schemaVersion: AI_REGISTRY_SCHEMA_VERSION,
    generatorVersion: GENERATOR_VERSION,
    analyzerVersion: AI_REGISTRY_ANALYZER_VERSION,
    inputHash: hashStable(
      canonicalJson({
        appInputHash: appGraph.inputHash,
        analyzerVersion: AI_REGISTRY_ANALYZER_VERSION,
      }),
    ),
    providers: buildProviders(classified),
    generations,
    tools,
    agents,
    diagnostics: [],
  };
}

export { KNOWN_MODELS };
