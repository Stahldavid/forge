import type { ProgramExpr, ProgramOperation, ProgramRef, WorkflowProgramV2 } from "./program-contract.ts";
import type { ProgramBlock } from "./program-structure.ts";

declare const registryKind: unique symbol;
declare const inputType: unique symbol;
declare const outputType: unique symbol;
export type WorkflowExpression<T = unknown> = ProgramExpr & { readonly [outputType]?: T };
export type WorkflowValue<T> = T | WorkflowExpression<T> | (T extends readonly (infer E)[] ? WorkflowValue<E>[] : T extends object ? { [K in keyof T]: WorkflowValue<T[K]> } : never);
export type WorkflowResolved<T> = T extends WorkflowExpression<infer V> ? V : T extends readonly unknown[] ? { [K in keyof T]: WorkflowResolved<T[K]> } : T extends object ? { [K in keyof T]: WorkflowResolved<T[K]> } : T;
export type WorkflowRef<K extends string, Input = unknown, Output = unknown> = ProgramRef & { readonly [registryKind]: K; readonly [inputType]?: Input; readonly [outputType]?: Output };
export type WorkflowDefinition = Omit<WorkflowProgramV2, "schemaVersion" | "inputSchema" | "outputSchema" | "policy" | "acceptance" | "population"> & {
  inputSchema: WorkflowRef<"schema">; outputSchema: WorkflowRef<"schema">;
  policy: WorkflowRef<"policy">; acceptance: WorkflowRef<"acceptance">; population?: WorkflowRef<"population">;
};
type Data = unknown;
export type WorkflowCollection<T> = { items: ({ key: string; outcome: "completed"; value: T } | { key: string; outcome: "failed" | "waiting"; reason?: string })[]; results: T[]; failures: { id: string; reason: string }[]; seal: string; coverage: unknown; status: "completed" | "partial" | "no-work" };
export type WorkflowBody<T> = WorkflowOperation<keyof WorkflowOptions, T> | (ProgramBlock & { result: WorkflowValue<T> });
type Body = ProgramOperation | ProgramBlock;
interface Common { after?: string[]; label?: string }
interface Activity extends Common { executor: WorkflowRef<"executor">; input?: Data; candidate?: Data; writeScope?: Data }
export interface WorkflowOptions {
  value: Common & { value: Data };
  agent: Activity;
  command: Activity;
  map: Common & { items: Data; key: Data; coverage?: Data; completion: "all-required" | "partial" | "quorum"; quorum?: { minAccepted: number }; concurrency?: number; order?: "key" | "input"; body: Body };
  branch: Common & { condition: boolean | ProgramExpr; then: Body; else: Body };
  loop: Common & { initialState: Data; maxRounds: number; body: Body; next: Data; until: boolean | ProgramExpr };
  repair: Common & { recipe: WorkflowRef<"recipe">; implement: WorkflowRef<"executor">; review: WorkflowRef<"executor">; checks: Data; input?: Data; evidence?: WorkflowRef<"executor">[]; assessmentScope?: "item" | "final"; entryMode: "implement-first" | "assess-first"; initialCandidate: Data; writeScope: Data; maxRepairRounds: number; maxAssessmentAttempts: number; maxInfrastructureAttempts: number; progressPolicy: { unchangedCandidateRounds: number; repeatedFindingsRounds: number } };
  compose: Common & { candidates: Data; onConflict?: "needs-resolution"; resolver?: WorkflowRef<"executor">; resolverInput?: Data; resolverWriteScope?: Data };
  gate: Common & { candidate: Data; coverage?: Data; authorization?: Data };
  subworkflow: Common & { program: WorkflowRef<"program">; input: Data };
  waitEvent: Common & { type: string; correlation: Data; schema: WorkflowRef<"schema">; subject?: Data; timeoutMs?: number };
  sequence: Common & ProgramBlock;
  parallel: Common & ProgramBlock & { onFailure: "collect-all" | "cancel-siblings" };
}
export type WorkflowOperation<K extends keyof WorkflowOptions = keyof WorkflowOptions, Output = unknown> = ProgramOperation & { kind: K; readonly [outputType]?: Output };
export type WorkflowActivityOptions<Input, Output> = Omit<WorkflowOptions["agent"], "executor" | "input"> & { executor: WorkflowRef<"executor", Input, Output>; input?: WorkflowValue<NoInfer<Input>> };
