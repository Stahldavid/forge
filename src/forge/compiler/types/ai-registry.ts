export type ForgeAiProvider = "openai" | "anthropic" | "gateway";

export interface AiProviderDefinition {
  id: ForgeAiProvider;
  packageName: string;
  secretName: string;
  integration: string;
}

export interface AiModelDefinition {
  provider: ForgeAiProvider;
  model: string;
  inputCostPer1kTokensUsd?: number;
  outputCostPer1kTokensUsd?: number;
}

export interface AiGenerationCall {
  provider: ForgeAiProvider;
  model: string;
  purpose?: string;
  method: "generateText" | "streamText" | "generateStructured";
  file: string;
}

export interface AiRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  providers: AiProviderDefinition[];
  generations: AiGenerationCall[];
  diagnostics: unknown[];
}
