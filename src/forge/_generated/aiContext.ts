// @forge-generated generator=0.0.0 input=a364a2ec435f1ad252c1d418c40d3d787ffd94db8ab078dc670d129e1ab2d4fd content=1a7f35fa6df0033ab837112f39b4684bbc4d255334885c29434ebddf169351e1
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
