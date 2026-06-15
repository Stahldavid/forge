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
  method: "generateText" | "streamText" | "generateStructured" | "runAgent";
  file: string;
}

export interface AiToolDefinition {
  name: string;
  file: string;
  description?: string;
  risk: "read" | "write" | "external" | "destructive" | "unknown";
  strict: boolean;
  needsApproval: boolean | "dynamic";
}

export interface AiAgentDefinition {
  name: string;
  file: string;
  provider: ForgeAiProvider;
  model: string;
  instructions?: string;
  tools: string[];
  stopWhen:
    | { kind: "stepCount"; maxSteps: number }
    | { kind: "toolCall"; toolName: string }
    | { kind: "default" };
}

export interface AiRegistry {
  schemaVersion: string;
  generatorVersion: string;
  analyzerVersion: string;
  inputHash: string;
  providers: AiProviderDefinition[];
  generations: AiGenerationCall[];
  tools: AiToolDefinition[];
  agents: AiAgentDefinition[];
  diagnostics: unknown[];
}
