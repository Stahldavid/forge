export interface ForgeContext {
  db: Record<string, unknown>;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
}

export interface ForgeCommandMeta {
  kind: "command";
}

export interface ForgeActionMeta {
  kind: "action";
  event?: string;
}

export type ForgeCommand<T> = (() => T | Promise<T>) & {
  __forge: ForgeCommandMeta;
};

export type ForgeAction<T> = (() => T | Promise<T>) & {
  __forge: ForgeActionMeta;
};

export interface ForgeCommandConfig<TArgs = unknown, TResult = unknown> {
  handler: (ctx: ForgeContext, args: TArgs) => TResult | Promise<TResult>;
}

export interface ForgeActionConfig<TArgs = unknown, TResult = unknown> {
  event?: string;
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
    __forge: { kind: "command" },
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
