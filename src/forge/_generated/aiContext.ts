// @forge-generated generator=0.1.0-alpha.23 input=eec97c876c38e3c86c16e6a488b4abbd0d9253406b5e3a492f6674a134d0d950 content=080be6d83e86fc0b867b41cf138f09387a3265be3c2b382692aafe3cecba0b2d
export type ForgeAiProvider = "openai" | "anthropic" | "gateway";

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
