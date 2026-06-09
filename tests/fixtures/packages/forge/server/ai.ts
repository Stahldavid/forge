export type ForgeAiProvider = "openai" | "anthropic" | "gateway";

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

export interface AiContext {
  generateText(input: ForgeGenerateTextInput): Promise<ForgeGenerateTextResult>;
  streamText(input: ForgeGenerateTextInput): Promise<{
    text: Promise<string>;
    textStream: AsyncIterable<string>;
  }>;
  generateStructured<T>(input: ForgeGenerateTextInput & { schema: unknown }): Promise<T>;
}
