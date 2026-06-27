export type ForgeAuthRule =
  | { kind: "policy"; policy: string }
  | { kind: "roles"; roles: string[] }
  | { kind: "permissions"; permissions: string[] }
  | { kind: "public" };

export type ForgeDefinition<T extends Record<string, unknown>> = T;

export type ForgeRecord = Record<string, any>;

export interface ForgeTelemetry {
  capture(name: string, payload?: Record<string, unknown>): Promise<void> | void;
}

export type ForgeAiProvider = "openai" | "anthropic" | "gateway";

export interface ForgeAiUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

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
  toolCalls: Array<{ toolName: string; input: unknown }>;
  toolResults: Array<{ toolName: string; output: unknown }>;
  steps: number;
  estimatedCostUsd?: number;
}

export interface ForgeAgentRuntime {
  run(input: ForgeRunAgentInput): Promise<ForgeRunAgentResult>;
}

export interface ForgeContext {
  db: ForgeRecord;
  emit(event: string, payload?: Record<string, unknown>): Promise<void> | void;
  telemetry: ForgeTelemetry;
  secrets: ForgeRecord;
  agent?: ForgeAgentRuntime;
  auth?: {
    userId?: string;
    tenantId?: string;
    roles?: string[];
    claims?: Record<string, unknown>;
  };
}

export type ForgeCommandDefinition<TArgs = unknown, TResult = unknown> = Record<string, unknown> & {
  auth?: ForgeAuthRule;
  handler: (ctx: ForgeContext, args: TArgs) => TResult | Promise<TResult>;
};

export type ForgeQueryDefinition<TArgs = unknown, TResult = unknown> = Record<string, unknown> & {
  auth?: ForgeAuthRule;
  handler: (ctx: ForgeContext, args?: TArgs) => TResult | Promise<TResult>;
};

export type ForgeLiveQueryDefinition<TArgs = unknown, TResult = unknown> = Record<string, unknown> & {
  auth?: ForgeAuthRule;
  handler: (ctx: ForgeContext, args?: TArgs) => TResult | Promise<TResult>;
};

export type ForgeActionDefinition<TEvent = unknown, TResult = unknown> = Record<string, unknown> & {
  event?: string;
  handler: (ctx: ForgeContext, event: TEvent) => TResult | Promise<TResult>;
};

export type ForgeAiToolRisk = "read" | "write" | "external" | "destructive";

export interface ForgeAiToolRuntimeContext {
  secrets: ForgeRecord;
  env: Record<string, string | undefined>;
  telemetry: ForgeTelemetry;
  auth?: ForgeContext["auth"];
}

export type ForgeAiToolDefinition<TArgs = unknown, TResult = unknown> = Record<string, unknown> & {
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
};

export type ForgeAgentStopWhen =
  | { kind: "stepCount"; maxSteps: number }
  | { kind: "toolCall"; toolName: string };

export type ForgeAgentDefinition = Record<string, unknown> & {
  provider?: "openai" | "anthropic" | "gateway";
  model: string;
  instructions: string;
  tools?: Record<string, ForgeAiToolDefinition> | string[];
  stopWhen?: ForgeAgentStopWhen;
  maxSteps?: number;
};

export function defineTable<T extends Record<string, unknown>>(definition: T): T {
  return definition;
}

export function definePolicies<T extends Record<string, unknown>>(definition: T): T {
  return definition;
}

export function can(policy: string): ForgeAuthRule {
  return { kind: "policy", policy };
}

export function canRole(...roles: string[]): ForgeAuthRule {
  return { kind: "roles", roles };
}

export function canPermission(...permissions: string[]): ForgeAuthRule {
  return { kind: "permissions", permissions };
}

export function public_(): ForgeAuthRule {
  return { kind: "public" };
}

export function command<
  TArgs = unknown,
  TResult = unknown,
  T extends ForgeCommandDefinition<TArgs, TResult> = ForgeCommandDefinition<TArgs, TResult>,
>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function query<T extends ForgeQueryDefinition>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function liveQuery<T extends ForgeLiveQueryDefinition>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function action<T extends ForgeActionDefinition>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function aiTool<T extends ForgeAiToolDefinition>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function agent<T extends ForgeAgentDefinition>(definition: T): ForgeDefinition<T> {
  return definition;
}

export function event(name: string): { kind: "event"; name: string } {
  return { kind: "event", name };
}

export function step<T extends (...args: any[]) => unknown>(
  name: string,
  handler: T,
): { kind: "step"; name: string; handler: T } {
  return { kind: "step", name, handler };
}

export function workflow<T extends Record<string, unknown>>(
  definition: T,
): ForgeDefinition<T & { __forge: { kind: "workflow" } }> {
  return {
    ...definition,
    __forge: { kind: "workflow" },
  };
}

export {
  MemoryWebhookReplayStore,
  verifyWebhookSignature,
} from "./runtime/webhooks/security.ts";
export type {
  WebhookProvider,
  WebhookReplayStore,
  WebhookVerificationInput,
  WebhookVerificationResult,
} from "./runtime/webhooks/security.ts";
