import type { WorkflowLimits, WorkflowNode, WorkflowState } from "./workflow-engine.ts";
import { createWorkflow } from "./workflow-engine.ts";
import { createHash } from "node:crypto";

export const MANAGED_RUN_ACTIONS = ["run-start", "run-status", "run-wait", "run-steer", "run-pause", "run-resume", "run-cancel", "run-reconcile"] as const;
export type ManagedRunAction = typeof MANAGED_RUN_ACTIONS[number];
export type ManagedRole = "implementer" | "reviewer" | "investigator" | "decision";
export interface ManagedExecutorSpec {
  nodeId: string; type: "codex" | "command"; role?: ManagedRole; prompt?: string;
  writeScope?: string[]; model?: string; argv?: string[]; timeoutMs?: number;
}
export interface ManagedRunSpec {
  requestId: string; goal: string; scope: string[];
  workflow: { workflowId: string; nodes: WorkflowNode[]; limits?: Partial<WorkflowLimits> };
  executors: ManagedExecutorSpec[]; publish?: boolean;
  environment?: { mode?: "auto" | "none"; ignoreScripts?: boolean; registry?: string; timeoutMs?: number };
}
export interface ManagedEvent { cursor: number; at: string; type: string; nodeId?: string; attemptId?: string; summary: string; threadId?: string }
export interface ManagedStep {
  nodeId: string; attemptId: string; status: "running" | "succeeded" | "failed" | "uncertain";
  directory?: string; inputDigest?: string; threadId?: string; summary?: string;
  report?: { summary: string; verdict?: "approved" | "changes_requested"; findings?: { description: string }[]; selectedNodeIds?: string[]; replanProposal?: string };
  usage?: { input_tokens: number; cached_input_tokens: number; output_tokens: number };
  artifact?: import("./managed-workspace.ts").ManagedArtifact;
  environment?: import("./managed-environment.ts").ManagedEnvironment;
  repositoryContext?: import("./repository-context.ts").FabricRepositoryContextMetadata;
}
export interface ManagedRunState {
  schemaVersion: 1; runId: string; repositoryRoot: string; ownerPid: number; version: number;
  spec: ManagedRunSpec; workflow: WorkflowState;
  base?: import("./managed-workspace.ts").ManagedBase;
  status: "preparing" | "running" | "paused" | "blocked" | "publishing" | "canceling" | "canceled" | "completed" | "failed";
  steps: ManagedStep[]; events: ManagedEvent[]; cursor: number; instructions: string[];
  createdAt: string; updatedAt: string; published?: { digest: string; changedFiles: string[] };
  publicationIntent?: { digest: string; changedFiles: string[] }; error?: string;
}
export class ManagedRunError extends Error { constructor(readonly code: string, message: string) { super(message); this.name = "ManagedRunError"; } }
export function managedFail(code: string, message: string): never { throw new ManagedRunError(code, message); }
export const managedDigest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export function managedId(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/u.test(value)) managedFail("AF_RUN_INPUT", `Invalid ${label}`);
  return value;
}
export function managedObject(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) managedFail("AF_RUN_INPUT", "Unexpected or invalid request fields");
}
export function managedText(value: unknown, label: string, max = 12000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) managedFail("AF_RUN_INPUT", `Invalid ${label}`);
  return value;
}
export function managedPaths(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || !value.length || value.length > 100 || new Set(value).size !== value.length || value.some(path => typeof path !== "string" || !path || path.length > 512 || path.includes("\\") || path.startsWith("/") || path.split("/").some((part: string) => !part || part === "." || part === ".." || part === ".git") || path.includes(":") || path.toLowerCase() === ".forge" || path.toLowerCase().startsWith(".forge/"))) managedFail("AF_RUN_INPUT", `Invalid ${label}`);
  return value as string[];
}
export function validateManagedSpec(value: unknown): ManagedRunSpec {
  managedObject(value, ["requestId", "goal", "scope", "workflow", "executors", "publish", "environment"]);
  if (value.environment !== undefined) {
    managedObject(value.environment, ["mode", "ignoreScripts", "registry", "timeoutMs"]);
    const environment = value.environment;
    if (environment.mode !== undefined && !["auto", "none"].includes(environment.mode as string)) managedFail("AF_RUN_ENVIRONMENT", "Invalid environment mode");
    if (environment.ignoreScripts !== undefined && typeof environment.ignoreScripts !== "boolean") managedFail("AF_RUN_ENVIRONMENT", "ignoreScripts must be boolean");
    if (environment.timeoutMs !== undefined && (!Number.isSafeInteger(environment.timeoutMs) || (environment.timeoutMs as number) < 100 || (environment.timeoutMs as number) > 1800000)) managedFail("AF_RUN_ENVIRONMENT", "Invalid environment deadline");
    if (environment.registry !== undefined) {
      let url: URL; try { url = new URL(managedText(environment.registry, "registry", 2048)); } catch { managedFail("AF_RUN_ENVIRONMENT", "Invalid registry URL"); }
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) managedFail("AF_RUN_ENVIRONMENT", "Registry requires HTTPS without embedded credentials");
    }
  }
  managedId(value.requestId, "requestId"); managedText(value.goal, "goal"); const scope = managedPaths(value.scope, "scope");
  managedObject(value.workflow, ["workflowId", "nodes", "limits"]);
  const workflow = createWorkflow(value.workflow as unknown as ManagedRunSpec["workflow"]);
  if (workflow.nodes.length > 32 || workflow.limits.maxConcurrency > 4 || workflow.limits.maxTotalAttempts > 100 || workflow.limits.maxRevisions > 20) managedFail("AF_RUN_LIMIT", "Managed workflow exceeds its limits");
  if (!Array.isArray(value.executors) || value.executors.length !== workflow.nodes.length) managedFail("AF_RUN_INPUT", "Every node requires exactly one executor");
  const executors = value.executors as ManagedExecutorSpec[]; const ids = new Set<string>();
  for (const executor of executors) {
    managedObject(executor, ["nodeId", "type", "role", "prompt", "writeScope", "model", "argv", "timeoutMs"]);
    const id = managedId(executor.nodeId, "nodeId"); const node = workflow.nodes.find(item => item.nodeId === id);
    if (!node || ids.has(id)) managedFail("AF_RUN_INPUT", "Invalid executor node"); ids.add(id);
    if (node.outputContract?.requiredEvidenceKinds?.some(kind => kind !== "executor-observed")) managedFail("AF_RUN_EVIDENCE", "Managed executors support only executor-observed evidence; agent reports are separate from proof");
    if (executor.timeoutMs !== undefined && (!Number.isSafeInteger(executor.timeoutMs) || executor.timeoutMs < 100 || executor.timeoutMs > 1800000)) managedFail("AF_RUN_LIMIT", "Invalid executor deadline");
    if (executor.writeScope !== undefined) {
      managedPaths(executor.writeScope, "writeScope");
      if (executor.writeScope.some(path => !scope.some(parent => path === parent || path.startsWith(`${parent}/`)))) managedFail("AF_RUN_SCOPE", "Write scope exceeds task scope");
    }
    if (executor.type === "codex") {
      if (!["implementer", "reviewer", "investigator", "decision"].includes(executor.role ?? "") || executor.argv !== undefined) managedFail("AF_RUN_INPUT", "Invalid Codex executor");
      managedText(executor.prompt, "prompt"); if (executor.model !== undefined) managedText(executor.model, "model", 100);
      if (executor.role !== "implementer" && executor.writeScope !== undefined) managedFail("AF_RUN_SCOPE", "Read-only workers cannot declare write scope");
      if (executor.role === "implementer" && !executor.writeScope) managedFail("AF_RUN_SCOPE", "Implementer requires a write scope");
      if ((node.kind === "decision") !== (executor.role === "decision")) managedFail("AF_RUN_INPUT", "Decision nodes require decision workers");
    } else if (executor.type === "command") {
      if (executor.role !== undefined || executor.prompt !== undefined || executor.model !== undefined || executor.writeScope !== undefined || node.kind === "decision") managedFail("AF_RUN_INPUT", "Invalid command executor");
      if (!Array.isArray(executor.argv) || !executor.argv.length || executor.argv.length > 40 || executor.argv.some(arg => typeof arg !== "string" || !arg || arg.length > 4096 || arg.includes("\0"))) managedFail("AF_RUN_INPUT", "Command argv required");
    } else managedFail("AF_RUN_INPUT", "Unknown executor type");
  }
  if (value.publish !== undefined && typeof value.publish !== "boolean") managedFail("AF_RUN_INPUT", "publish must be boolean");
  const writers = executors.filter(item => item.role === "implementer");
  if (writers.length && value.publish !== false) {
    const ancestor = (nodeId: string, target: string): boolean => workflow.nodes.find(node => node.nodeId === nodeId)!.dependsOn.some(id => id === target || ancestor(id, target));
    if (!executors.some(item => item.role === "reviewer" && workflow.nodes.find(node => node.nodeId === item.nodeId)!.required && writers.every(writer => ancestor(item.nodeId, writer.nodeId)))) managedFail("AF_RUN_REVIEW_REQUIRED", "Publishing requires a required independent review of every writer");
    if (!executors.some(item => item.type === "command" && workflow.nodes.find(node => node.nodeId === item.nodeId)!.required && writers.every(writer => ancestor(item.nodeId, writer.nodeId)))) managedFail("AF_RUN_CHECK_REQUIRED", "Publishing requires a required command verification of every writer");
  }
  return structuredClone(value) as unknown as ManagedRunSpec;
}
