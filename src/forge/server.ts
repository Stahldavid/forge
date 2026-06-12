export type ForgeAuthRule =
  | { kind: "policy"; policy: string }
  | { kind: "roles"; roles: string[] }
  | { kind: "public" };

export type ForgeDefinition<T extends Record<string, unknown>> = T;

export type ForgeRecord = Record<string, any>;

export interface ForgeTelemetry {
  capture(name: string, payload?: Record<string, unknown>): Promise<void> | void;
}

export interface ForgeContext {
  db: ForgeRecord;
  emit(event: string, payload?: Record<string, unknown>): Promise<void> | void;
  telemetry: ForgeTelemetry;
  secrets: ForgeRecord;
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

export function public_(): ForgeAuthRule {
  return { kind: "public" };
}

export function command<T extends ForgeCommandDefinition>(definition: T): ForgeDefinition<T> {
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

export function event(name: string): { kind: "event"; name: string } {
  return { kind: "event", name };
}

export function step<T extends (...args: any[]) => unknown>(
  name: string,
  handler: T,
): { kind: "step"; name: string; handler: T } {
  return { kind: "step", name, handler };
}

export function workflow<T extends Record<string, unknown>>(definition: T): ForgeDefinition<T> {
  return definition;
}
