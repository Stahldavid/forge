import type { AuthContext } from "./auth.ts";
import type { AuthRequirement } from "../policy/index.ts";
import type { ForgeRunAgentInput, ForgeRunAgentResult } from "./ai.ts";

export type { AuthContext };

export type {
  AiContext,
  ForgeAiToolDefinition,
  ForgeAiToolRuntimeContext,
  ForgeRunAgentInput,
  ForgeRunAgentResult,
  ForgeGenerateTextInput,
  ForgeGenerateTextResult,
} from "./ai.ts";

export interface ForgeContext {
  db: Record<string, any>;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  secrets: {
    get(name: string): string;
    optional(name: string): string | undefined;
    has(name: string): boolean;
  };
  telemetry: import("./telemetry.ts").TelemetryContext;
  auth: AuthContext;
  /** Injected by Forge runtime on server/action/workflow/endpoint contexts. */
  ai: import("./ai.ts").AiContext;
  /** Alias for agent-native code. Delegates to ctx.ai.runAgent at runtime. */
  agent: {
    run(input: ForgeRunAgentInput): Promise<ForgeRunAgentResult>;
  };
}

export interface ForgeCommandMeta {
  kind: "command";
  auth?: AuthRequirement;
}

export interface ForgeActionMeta {
  kind: "action";
  event?: string;
  auth?: AuthRequirement;
}

export type ForgeCommand<T> = (() => T | Promise<T>) & {
  __forge: ForgeCommandMeta;
};

export type ForgeAction<T> = (() => T | Promise<T>) & {
  __forge: ForgeActionMeta;
};

export interface ForgeCommandConfig<TArgs = unknown, TResult = unknown> {
  auth?: AuthRequirement;
  handler: (ctx: ForgeContext, args: TArgs) => TResult | Promise<TResult>;
}

export interface ForgeActionConfig<TArgs = unknown, TResult = unknown> {
  event?: string;
  auth?: AuthRequirement;
  idempotencyKey?: (event: unknown) => string;
  handler: (ctx: ForgeContext, args: TArgs) => TResult | Promise<TResult>;
}

export function command<TArgs = unknown, TResult = unknown>(
  fnOrConfig:
    | (() => TResult | Promise<TResult>)
    | ForgeCommandConfig<TArgs, TResult>,
): ForgeCommand<TResult> | (ForgeCommandConfig<TArgs, TResult> & { __forge: ForgeCommandMeta }) {
  if (typeof fnOrConfig === "function") {
    const handler = fnOrConfig as ForgeCommand<TResult>;
    handler.__forge = { kind: "command" };
    return handler;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "command",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export function action<TArgs = unknown, TResult = unknown>(
  fnOrConfig:
    | (() => TResult | Promise<TResult>)
    | ForgeActionConfig<TArgs, TResult>,
): ForgeAction<TResult> | (ForgeActionConfig<TArgs, TResult> & { __forge: ForgeActionMeta }) {
  if (typeof fnOrConfig === "function") {
    const handler = fnOrConfig as ForgeAction<TResult>;
    handler.__forge = { kind: "action" };
    return handler;
  }

  const meta: ForgeActionMeta = { kind: "action" };
  if (fnOrConfig.event !== undefined) {
    meta.event = fnOrConfig.event;
  }
  if (fnOrConfig.auth !== undefined) {
    meta.auth = fnOrConfig.auth;
  }

  return {
    ...fnOrConfig,
    __forge: meta,
  };
}

export interface ForgeAiToolMeta {
  kind: "aiTool";
}

export type ForgeAiTool<TArgs = unknown, TResult = unknown> =
  import("./ai.ts").ForgeAiToolDefinition<TArgs, TResult> & {
    __forge: ForgeAiToolMeta;
  };

export function aiTool<TArgs = unknown, TResult = unknown>(
  config: import("./ai.ts").ForgeAiToolDefinition<TArgs, TResult>,
): ForgeAiTool<TArgs, TResult> {
  return {
    ...config,
    __forge: { kind: "aiTool" },
  };
}

export interface ForgeAgentDefinition {
  provider?: import("./ai.ts").ForgeAiProvider;
  model: string;
  instructions: string;
  tools?: Record<string, import("./ai.ts").ForgeAiToolDefinition> | string[];
  stopWhen?: import("./ai.ts").ForgeAgentStopWhen;
  maxSteps?: number;
}

export type ForgeAgent = ForgeAgentDefinition & {
  __forge: { kind: "agent" };
};

export function agent(config: ForgeAgentDefinition): ForgeAgent {
  return {
    ...config,
    __forge: { kind: "agent" },
  };
}

export interface WorkflowRunRecord {
  id: number;
  workflowName: string;
  status: string;
  input: unknown;
  currentStep: string | null;
}

export interface WorkflowRunContext {
  input: unknown;
  steps: Record<string, { output: unknown }>;
  db: Record<string, any>;
  env: Record<string, string | undefined>;
  secrets: ForgeContext["secrets"];
  telemetry: import("./telemetry.ts").TelemetryContext;
  auth: AuthContext;
  ai: import("./ai.ts").AiContext;
  agent: {
    run(input: ForgeRunAgentInput): Promise<ForgeRunAgentResult>;
  };
}

export interface WorkflowStepDefinition<T = unknown> {
  name: string;
  handler: (
    ctx: WorkflowRunContext,
    run: WorkflowRunRecord,
  ) => T | Promise<T>;
}

export interface WorkflowDefinition {
  trigger?: { type: "event"; eventType: string };
  steps: WorkflowStepDefinition[];
  auth?: AuthRequirement;
  idempotencyKey?: (input: unknown) => string;
}

export type ForgeWorkflow = WorkflowDefinition & {
  __forge: { kind: "workflow" };
};

export function event(eventType: string): { type: "event"; eventType: string } {
  return { type: "event", eventType };
}

export function step<T>(
  name: string,
  handler: (
    ctx: WorkflowRunContext,
    run: WorkflowRunRecord,
  ) => T | Promise<T>,
): WorkflowStepDefinition<T> {
  return { name, handler };
}

export function workflow(config: WorkflowDefinition): ForgeWorkflow {
  return {
    ...config,
    __forge: { kind: "workflow" },
  };
}

export interface ForgeQueryMeta {
  kind: "query";
  auth?: AuthRequirement;
}

export interface ForgeLiveQueryMeta {
  kind: "liveQuery";
  auth?: AuthRequirement;
}

export interface ForgeQueryConfig<TArgs = unknown, TResult = unknown> {
  auth?: AuthRequirement;
  handler: (
    ctx: Pick<ForgeContext, "db" | "telemetry" | "auth">,
    args: TArgs,
  ) => TResult | Promise<TResult>;
}

export type ForgeQuery<TResult = unknown> = (() => TResult | Promise<TResult>) & {
  __forge: ForgeQueryMeta;
};

export type ForgeLiveQuery<TResult = unknown> = (() => TResult | Promise<TResult>) & {
  __forge: ForgeLiveQueryMeta;
};

export function query<TArgs = unknown, TResult = unknown>(
  fnOrConfig:
    | (() => TResult | Promise<TResult>)
    | ForgeQueryConfig<TArgs, TResult>,
): ForgeQuery<TResult> | (ForgeQueryConfig<TArgs, TResult> & { __forge: ForgeQueryMeta }) {
  if (typeof fnOrConfig === "function") {
    const handler = fnOrConfig as ForgeQuery<TResult>;
    handler.__forge = { kind: "query" };
    return handler;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "query",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export function liveQuery<TArgs = unknown, TResult = unknown>(
  fnOrConfig:
    | (() => TResult | Promise<TResult>)
    | ForgeQueryConfig<TArgs, TResult>,
): ForgeLiveQuery<TResult> | (ForgeQueryConfig<TArgs, TResult> & { __forge: ForgeLiveQueryMeta }) {
  if (typeof fnOrConfig === "function") {
    const handler = fnOrConfig as ForgeLiveQuery<TResult>;
    handler.__forge = { kind: "liveQuery" };
    return handler;
  }

  return {
    ...fnOrConfig,
    __forge: {
      kind: "liveQuery",
      ...(fnOrConfig.auth ? { auth: fnOrConfig.auth } : {}),
    },
  };
}

export type WebhookProvider = "generic" | "github" | "stripe" | "workos";

export interface WebhookReplayStore {
  has(eventId: string): boolean | Promise<boolean>;
  add(eventId: string): void | Promise<void>;
}

export interface WebhookVerificationInput {
  provider: WebhookProvider;
  secret: string;
  payload: string | Uint8Array;
  signatureHeader: string | null | undefined;
  timestampHeader?: string | null;
  eventId?: string;
  replayStore?: WebhookReplayStore;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export interface WebhookVerificationResult {
  ok: boolean;
  code?: string;
  reason?: string;
  provider: WebhookProvider;
}

export async function verifyWebhookSignature(
  input: WebhookVerificationInput,
): Promise<WebhookVerificationResult> {
  return { ok: true, provider: input.provider };
}

export { defineTable } from "../schema/index.ts";
export type { AuthRequirement, PolicyDefinition } from "../policy/index.ts";
export { can, canPermission, canRole, definePolicies, public_, system } from "../policy/index.ts";
