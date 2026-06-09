import type { AuthContext } from "./auth.ts";
import type { AuthRequirement } from "../policy/index.ts";

export type { AuthContext };

export type {
  AiContext,
  ForgeGenerateTextInput,
  ForgeGenerateTextResult,
} from "./ai.ts";

export interface ForgeContext {
  db: Record<string, unknown>;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  telemetry: import("./telemetry.ts").TelemetryContext;
  auth: AuthContext;
  /** Injected by Forge runtime on server/action/workflow/endpoint contexts. */
  ai: import("./ai.ts").AiContext;
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
  db: Record<string, unknown>;
  env: Record<string, string | undefined>;
  telemetry: import("./telemetry.ts").TelemetryContext;
  auth: AuthContext;
  ai: import("./ai.ts").AiContext;
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

export { defineTable } from "../schema/index.ts";
export type { AuthRequirement, PolicyDefinition } from "../policy/index.ts";
export { can, canRole, definePolicies, public_, system } from "../policy/index.ts";
