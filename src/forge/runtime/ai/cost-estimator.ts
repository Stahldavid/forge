import type { ForgeAiProvider, ForgeAiUsage } from "./types.ts";

export interface ModelCostRates {
  inputCostPer1kTokensUsd: number;
  outputCostPer1kTokensUsd: number;
}

const KNOWN_MODEL_COSTS: Record<string, ModelCostRates> = {
  "openai:gpt-4o": { inputCostPer1kTokensUsd: 0.0025, outputCostPer1kTokensUsd: 0.01 },
  "openai:gpt-4o-mini": {
    inputCostPer1kTokensUsd: 0.00015,
    outputCostPer1kTokensUsd: 0.0006,
  },
  "anthropic:claude-3-5-sonnet-20241022": {
    inputCostPer1kTokensUsd: 0.003,
    outputCostPer1kTokensUsd: 0.015,
  },
  "anthropic:claude-3-5-haiku-20241022": {
    inputCostPer1kTokensUsd: 0.0008,
    outputCostPer1kTokensUsd: 0.004,
  },
  "gateway:openai/gpt-4o": {
    inputCostPer1kTokensUsd: 0.0025,
    outputCostPer1kTokensUsd: 0.01,
  },
};

export function estimateCostUsd(
  provider: ForgeAiProvider,
  model: string,
  usage: ForgeAiUsage,
): number | undefined {
  const rates = KNOWN_MODEL_COSTS[`${provider}:${model}`];
  if (!rates) {
    return undefined;
  }

  const inputCost = (usage.promptTokens / 1000) * rates.inputCostPer1kTokensUsd;
  const outputCost = (usage.completionTokens / 1000) * rates.outputCostPer1kTokensUsd;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}
