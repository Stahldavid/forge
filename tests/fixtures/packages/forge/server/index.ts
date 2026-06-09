export interface ForgeCommandMeta {
  kind: "command";
}

export interface ForgeActionMeta {
  kind: "action";
}

export type ForgeCommand<T> = (() => T | Promise<T>) & {
  __forge: ForgeCommandMeta;
};

export type ForgeAction<T> = (() => T | Promise<T>) & {
  __forge: ForgeActionMeta;
};

export function command<T>(fn: () => T | Promise<T>): ForgeCommand<T> {
  const handler = fn as ForgeCommand<T>;
  handler.__forge = { kind: "command" };
  return handler;
}

export function action<T>(fn: () => T | Promise<T>): ForgeAction<T> {
  const handler = fn as ForgeAction<T>;
  handler.__forge = { kind: "action" };
  return handler;
}

export { defineTable } from "../schema/index.ts";
