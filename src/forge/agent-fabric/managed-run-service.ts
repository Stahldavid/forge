import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { stableStringify } from "./canonical.ts";
import {
  MANAGED_RUN_ACTIONS, managedDigest, managedFail, managedId, managedObject, managedText,
  validateManagedSpec, type ManagedRunState, type ManagedRunSpec, type ManagedStep, type ManagedEvent,
} from "./managed-run-contract.ts";
import { ManagedRunStore } from "./managed-run-store.ts";
import { runCodexWorker, type CodexWorkerInput, type CodexWorkerOutput, codexWorkerEnvironment } from "./codex-sdk-worker.ts";
import { prepareManagedEnvironment } from "./managed-environment.ts";
import {
  captureManagedBase, prepareManagedWorkspace, captureManagedArtifact, publishManagedArtifacts,
  previewManagedArtifacts, confirmManagedPublication, confirmManagedBaseline, type ManagedArtifact,
} from "./managed-workspace.ts";
import { createWorkflow, nextWorkflow, claimWorkflow, completeWorkflow, recoverWorkflow, reconcileWorkflow, replanWorkflow, type WorkflowNode } from "./workflow-engine.ts";

interface ServiceOptions { worker?: (input: CodexWorkerInput) => Promise<CodexWorkerOutput>; closeTimeoutMs?: number; publisher?: typeof publishManagedArtifacts }
interface ActiveWorker { controller: AbortController; promise: Promise<void> }
const COMMON = ["runId", "requestId", "expectedVersion"];
const terminal = (state: ManagedRunState) => ["completed", "canceled", "failed"].includes(state.status);
const processOwners = new Map<string, symbol>();
const ownerKey = (root: string) => process.platform === "win32" ? root.toLowerCase() : root;
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Managed execution failed").slice(0, 4096);
function event(state: ManagedRunState, type: string, summary: string, details: Partial<Pick<ManagedEvent, "nodeId" | "attemptId" | "threadId">> = {}): void {
  state.cursor++;
  state.events.push({ cursor: state.cursor, at: new Date().toISOString(), type, summary: summary.slice(0, 4096), ...details });
  if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
}
function boundNodes(spec: ManagedRunSpec): WorkflowNode[] {
  return spec.workflow.nodes.map(node => ({ ...node, inputDigest: managedDigest(stableStringify({ declared: node.inputDigest, executor: spec.executors.find(item => item.nodeId === node.nodeId), environment: spec.environment ?? { mode: "auto", ignoreScripts: true } })) }));
}
function applicableSteps(state: ManagedRunState): ManagedStep[] {
  return state.workflow.nodes.flatMap(node => {
    const generation = state.workflow.generations.find(item => item.nodeId === node.nodeId)!.generation;
    const run = state.workflow.runs.find(item => item.nodeId === node.nodeId && item.generation === generation && item.status === "succeeded");
    const step = run && state.steps.find(item => item.attemptId === run.attemptId);
    return step ? [step] : [];
  });
}
/** Ordered ancestry makes independent artifacts reusable while dependent changes compose. */
function dependencyArtifacts(state: ManagedRunState, nodeId?: string): ManagedArtifact[] {
  const applicable = new Map(applicableSteps(state).map(step => [step.nodeId, step]));
  const visited = new Set<string>(), ordered: ManagedArtifact[] = [];
  const visit = (id: string) => {
    if (visited.has(id)) return; visited.add(id);
    const node = state.workflow.nodes.find(item => item.nodeId === id)!;
    for (const parent of node.dependsOn) visit(parent);
    const artifact = applicable.get(id)?.artifact; if (artifact?.files.length) ordered.push(artifact);
  };
  if (nodeId) for (const id of state.workflow.nodes.find(node => node.nodeId === nodeId)!.dependsOn) visit(id);
  else for (const node of state.workflow.nodes) visit(node.nodeId);
  return ordered;
}
function publicState(state: ManagedRunState) {
  const next = nextWorkflow(state.workflow);
  return {
    runId: state.runId, version: state.version, status: state.status, goal: state.spec.goal, scope: state.spec.scope,
    workflow: { workflowId: state.workflow.workflowId, revision: state.workflow.revision, complete: next.complete, blockedReasons: next.blockedReasons, nextNodes: next.packets.map(packet => packet.nodeId) },
    steps: state.steps.map(({ artifact, ...step }) => ({ ...step, ...(artifact ? { artifact: { digest: artifact.digest, changedFiles: artifact.files.map(file => file.path) } } : {}) })),
    cursor: state.cursor, instructions: state.instructions, ...(state.published ? { published: state.published } : {}),
    ...(state.publicationIntent ? { publicationIntent: state.publicationIntent } : {}), ...(state.error ? { error: state.error } : {}),
    provenance: "executor_observed", reportProvenance: "agent_reported",
  };
}

/** The original Codex App chat drives this owner through MCP/CLI; workers use SDK threads. */
export class ManagedRunService {
  private readonly loops = new Map<string, Promise<void>>();
  private readonly workers = new Map<string, Map<string, ActiveWorker>>();
  private readonly waiters = new Map<string, Set<() => void>>();
  private closed = false;
  private publicationsInFlight = 0;
  private constructor(readonly root: string, readonly store: ManagedRunStore, private readonly options: ServiceOptions, private readonly ownerToken: symbol) {}
  private releaseOwner(): void { const key = ownerKey(this.root); if (processOwners.get(key) === this.ownerToken) processOwners.delete(key); }
  static async open(root: string, options: ServiceOptions = {}): Promise<ManagedRunService> {
    root = await realpath(root);
    const key = ownerKey(root);
    if (processOwners.has(key)) managedFail("AF_RUN_OWNER_ACTIVE", "This process already owns managed execution for the repository");
    const token = Symbol("managed-owner"); processOwners.set(key, token);
    try {
    const service = new ManagedRunService(root, await ManagedRunStore.open(root), options, token);
    for (const runId of await service.store.list()) {
      const old = await service.store.read(runId); if (!old || terminal(old)) continue;
      if (old.repositoryRoot !== root) managedFail("AF_RUN_STORE", "Run belongs to another repository");
      if (old.ownerPid !== process.pid) {
        try { process.kill(old.ownerPid, 0); managedFail("AF_RUN_OWNER_ACTIVE", "Another live owner holds this run"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        if (old.status === "publishing" && old.base && await confirmManagedPublication(old.base, dependencyArtifacts(old))) {
          await service.update(runId, state => { state.ownerPid = process.pid; state.status = "completed"; state.published = state.publicationIntent; event(state, "publication.reconciled", "Observed complete local publication after owner restart"); });
        } else await service.update(runId, state => {
          state.ownerPid = process.pid; state.workflow = recoverWorkflow(state.workflow, "Owner interrupted; inspect effects before retry");
          for (const step of state.steps.filter(item => item.status === "running")) step.status = "uncertain";
          state.status = "blocked"; state.error = state.publicationIntent ? "Local publication was interrupted; inspect scoped files and confirm the intended result" : "Owner restarted; reconcile interrupted attempts before resuming";
          event(state, "run.recovered", state.error);
        });
      }
    }
    return service;
    } catch (error) { if (processOwners.get(key) === token) processOwners.delete(key); throw error; }
  }
  private wake(runId: string): void { for (const callback of this.waiters.get(runId) ?? []) callback(); }
  private async require(runId: string): Promise<ManagedRunState> {
    const state = await this.store.read(runId); if (!state) managedFail("AF_RUN_NOT_FOUND", "Managed run does not exist"); return state;
  }
  private async update(runId: string, apply: (state: ManagedRunState) => void): Promise<ManagedRunState> {
    const result = await this.store.transact(runId, {}, current => { if (!current) managedFail("AF_RUN_NOT_FOUND", "Managed run does not exist"); if (!terminal(current)) apply(current); return current; });
    this.wake(runId); return result.state;
  }
  async execute(action: string, body: Record<string, unknown>): Promise<unknown> {
    if (!(MANAGED_RUN_ACTIONS as readonly string[]).includes(action)) managedFail("AF_RUN_ACTION", "Unknown managed operation");
    if (this.closed) managedFail("AF_RUN_OWNER_CLOSED", "Managed owner is closing");
    if (action === "run-start") {
      const spec = validateManagedSpec(body); const runId = `run-${managedDigest(spec.requestId).slice(7, 39)}`;
      const created = await this.store.transact(runId, { requestId: spec.requestId, fingerprint: managedDigest(stableStringify(body)) }, old => {
        if (old) managedFail("AF_RUN_REQUEST_CONFLICT", "Run request already exists");
        const now = new Date().toISOString(); const state: ManagedRunState = { schemaVersion: 1, runId, repositoryRoot: this.root, ownerPid: process.pid, version: 1, spec,
          workflow: createWorkflow({ ...spec.workflow, nodes: boundNodes(spec) }), status: "preparing", steps: [], events: [], cursor: 0, instructions: [], createdAt: now, updatedAt: now };
        event(state, "run.started", "Preparing immutable source and isolated workers"); return state;
      });
      this.kick(runId); return created.ack;
    }
    const runId = managedId(body.runId, "runId");
    if (action === "run-status") { managedObject(body, ["runId"]); return publicState(await this.require(runId)); }
    if (action === "run-wait") {
      managedObject(body, ["runId", "cursor", "waitMs"]);
      const cursor = body.cursor ?? 0, waitMs = body.waitMs ?? 30000;
      if (!Number.isSafeInteger(cursor) || (cursor as number) < 0 || !Number.isSafeInteger(waitMs) || (waitMs as number) < 0 || (waitMs as number) > 30000) managedFail("AF_RUN_INPUT", "Invalid event cursor or wait deadline");
      let state = await this.require(runId);
      if ((cursor as number) > state.cursor) managedFail("AF_RUN_CURSOR", "Cursor is ahead of the run");
      if (state.cursor <= (cursor as number) && !terminal(state) && (waitMs as number) > 0) {
        await new Promise<void>(resolve => {
          const callbacks = this.waiters.get(runId) ?? new Set<() => void>(); this.waiters.set(runId, callbacks);
          const finish = () => { clearTimeout(timer); callbacks.delete(finish); resolve(); };
          const timer = setTimeout(finish, waitMs as number); callbacks.add(finish);
          // Register before a second read so completion cannot be missed between read and wait.
          void this.require(runId).then(latest => { if (latest.cursor > (cursor as number) || terminal(latest)) finish(); }, finish);
        });
        state = await this.require(runId);
      }
      return { run: publicState(state), cursor: state.cursor, events: state.events.filter(item => item.cursor > (cursor as number)), cursorExpired: state.events.length > 0 && (cursor as number) < state.events[0].cursor - 1 };
    }
    managedId(body.requestId, "requestId");
    if (!Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 1) managedFail("AF_RUN_VERSION", "expectedVersion required");
    const fields = action === "run-steer" ? ["instruction"] : action === "run-resume" ? ["expectedRevision", "nodes", "executors", "environment", "reason", "evidenceRefs"] : action === "run-reconcile" ? ["attemptId", "resolution", "reason", "publication"] : [];
    managedObject(body, [...COMMON, ...fields]);
    if (action === "run-reconcile" && body.publication === "confirm") {
      const current = await this.require(runId);
      if (!current.base || !current.publicationIntent || !(await confirmManagedPublication(current.base, dependencyArtifacts(current)))) managedFail("AF_RUN_PUBLICATION", "Actual files do not match the intended publication");
    }
    if (action === "run-reconcile" && body.publication === "retry") {
      const current = await this.require(runId);
      if (current.publicationIntent && (!current.base || !(await confirmManagedBaseline(current.base)))) managedFail("AF_RUN_PUBLICATION", "Publication retry requires an observed complete immutable baseline; preserve partial writes for inspection");
    }
    const result = await this.store.transact(runId, { requestId: body.requestId as string, fingerprint: managedDigest(stableStringify(body)), expectedVersion: body.expectedVersion as number }, state => {
      if (!state) managedFail("AF_RUN_NOT_FOUND", "Managed run does not exist");
      if (terminal(state)) managedFail("AF_RUN_TERMINAL", "Managed run already ended");
      if (state.status === "publishing") managedFail("AF_RUN_PUBLICATION", "Publication in progress; wait for its observed result");
      if (action === "run-pause") { state.status = "paused"; event(state, "run.paused", "New dispatches paused; existing workers may finish"); }
      if (action === "run-steer") {
        if (state.instructions.length >= 20) managedFail("AF_RUN_LIMIT", "Steering instruction limit reached");
        state.instructions.push(managedText(body.instruction, "instruction", 4096)); state.status = "paused";
        event(state, "run.steered", "Instruction queued for subsequent workers; resume or replan explicitly");
      }
      if (action === "run-cancel") { state.status = "canceling"; event(state, "run.cancel_requested", "Cancel requested; in-flight outcomes must be observed"); }
      if (action === "run-reconcile") {
        if (body.publication === "confirm") { state.published = state.publicationIntent; state.status = "completed"; delete state.error; event(state, "publication.reconciled", "Actual scoped files match the intended publication"); }
        else if (body.publication === "retry") {
          if (!state.base || !state.publicationIntent) managedFail("AF_RUN_PUBLICATION", "No interrupted publication to retry");
          delete state.publicationIntent; delete state.error; state.status = "paused";
          event(state, "publication.retry_authorized", "Observed original baseline; publication intent cleared, explicit resume required");
        }
        else {
          if (body.resolution !== "failed") managedFail("AF_RUN_RECONCILE", "Only explicit abandonment of an uncertain attempt is accepted");
          const attemptId = managedId(body.attemptId, "attemptId"), reason = managedText(body.reason, "reason", 4096);
          state.workflow = reconcileWorkflow(state.workflow, { attemptId, result: { status: "failed", reason } });
          const step = state.steps.find(item => item.attemptId === attemptId)!; step.status = "failed"; step.summary = reason;
          state.status = "paused"; event(state, "attempt.reconciled", reason, { nodeId: step.nodeId, attemptId });
        }
      }
      if (action === "run-resume") {
        if (state.publicationIntent) managedFail("AF_RUN_PUBLICATION", "Interrupted publication requires inspection and confirmation");
        if (state.workflow.runs.some(run => run.status === "uncertain")) managedFail("AF_RUN_UNCERTAIN", "Reconcile uncertain attempts before resuming");
        if (body.nodes !== undefined || body.executors !== undefined || body.environment !== undefined) {
          const proposal = validateManagedSpec({ ...state.spec, workflow: { ...state.spec.workflow, nodes: body.nodes ?? state.spec.workflow.nodes }, executors: body.executors ?? state.spec.executors, ...(body.environment !== undefined ? { environment: body.environment } : {}) });
          state.workflow = replanWorkflow(state.workflow, { nodes: boundNodes(proposal), expectedRevision: body.expectedRevision as number, reason: managedText(body.reason, "reason", 4096), evidenceRefs: body.evidenceRefs as string[] });
          state.spec = proposal; event(state, "workflow.replanned", body.reason as string);
        }
        state.status = state.base ? "running" : "preparing"; delete state.error; event(state, "run.resumed", "Authorized dispatch resumed");
      }
      return state;
    });
    this.wake(runId);
    if (!result.replayed && action === "run-cancel") for (const worker of this.workers.get(runId)?.values() ?? []) worker.controller.abort();
    if (action === "run-resume" || action === "run-cancel") this.kick(runId);
    return result.ack;
  }
  private kick(runId: string): void {
    if (this.closed || this.loops.has(runId)) return;
    const promise = this.loop(runId).catch(async error => {
      if ((error as { code?: string }).code === "AF_RUN_PAUSED") return;
      for (const worker of this.workers.get(runId)?.values() ?? []) worker.controller.abort();
      if (this.closed) return;
      await this.update(runId, state => { state.status = "blocked"; state.error = errorText(error); event(state, "run.blocked", state.error); }).catch(() => {});
    }).finally(async () => {
      this.loops.delete(runId);
      // Resume can arrive while the previous loop is still unwinding.
      if (!this.closed) {
        const latest = await this.require(runId).catch(() => undefined);
        if (latest && ["preparing", "running", "canceling"].includes(latest.status)) this.kick(runId);
      }
    });
    this.loops.set(runId, promise);
  }
  private async loop(runId: string): Promise<void> {
    let state = await this.require(runId);
    if (state.status === "preparing") {
      const base = state.base ?? await captureManagedBase(this.root, runId, state.spec.scope);
      if (this.closed) return;
      state = await this.update(runId, current => { current.base = base; if (current.status === "preparing") current.status = "running"; event(current, "source.prepared", "Immutable baseline captured including scoped local changes"); });
    }
    while (!this.closed) {
      state = await this.require(runId); const active = this.workers.get(runId) ?? new Map<string, ActiveWorker>(); this.workers.set(runId, active);
      if (state.status === "canceling") {
        if (active.size) { await Promise.race([...active.values()].map(item => item.promise)); continue; }
        await this.update(runId, current => {
          const uncertain = current.workflow.runs.some(run => run.status === "uncertain");
          current.status = uncertain ? "blocked" : "canceled";
          if (uncertain) current.error = "Cancellation did not confirm all outcomes; reconcile uncertain workers";
          event(current, uncertain ? "run.blocked" : "run.canceled", uncertain ? current.error! : "All managed attempts settled without publication");
        }); return;
      }
      if (state.status !== "running") return;
      const schedule = nextWorkflow(state.workflow);
      if (schedule.complete && !active.size) {
        const artifacts = dependencyArtifacts(state);
        if (state.spec.publish !== false && artifacts.length) {
          const intent = await previewManagedArtifacts(state.base!, artifacts);
          state = await this.update(runId, current => { if (current.status !== "running") managedFail("AF_RUN_PAUSED", "Run was paused before publication"); current.publicationIntent = intent; current.status = "publishing"; event(current, "publication.started", "Reviewed and verified artifact publication recorded before local writes"); });
          if (this.closed) return;
          this.publicationsInFlight++;
          let published: Awaited<ReturnType<typeof publishManagedArtifacts>>;
          try { published = await (this.options.publisher ?? publishManagedArtifacts)(state.base!, artifacts); }
          finally {
            this.publicationsInFlight--;
            if (this.closed && !this.publicationsInFlight) this.releaseOwner();
          }
          if (this.closed) return;
          if (published.digest !== intent.digest) managedFail("AF_RUN_PUBLICATION", "Publication digest differs from reviewed artifacts");
          await this.update(runId, current => { if (this.closed || current.status !== "publishing" || current.publicationIntent?.digest !== intent.digest) return; current.published = published; current.status = "completed"; event(current, "run.completed", "All obligations passed and scoped changes were published locally"); });
        } else await this.update(runId, current => { if (current.status === "running") { current.status = "completed"; event(current, "run.completed", "All required workflow obligations completed"); } });
        return;
      }
      for (const packet of schedule.packets) {
        const current = await this.require(runId); if (this.closed || current.status !== "running") break;
        if (current.workflow.revision !== packet.revision) break;
        const attemptId = `attempt-${randomUUID()}`, controller = new AbortController();
        await this.update(runId, record => {
          if (this.closed || record.status !== "running") managedFail("AF_RUN_PAUSED", "Run stopped before dispatch");
          record.workflow = claimWorkflow(record.workflow, { nodeId: packet.nodeId, attemptId, executorId: "managed-owner", expectedRevision: packet.revision });
          record.steps.push({ nodeId: packet.nodeId, attemptId, status: "running" }); event(record, "attempt.claimed", "Attempt persisted before worker dispatch", { nodeId: packet.nodeId, attemptId });
        });
        if (this.closed) controller.abort();
        const promise = this.executeStep(runId, packet.nodeId, attemptId, controller).finally(() => { active.delete(attemptId); this.wake(runId); if (!this.loops.has(runId)) this.kick(runId); });
        active.set(attemptId, { controller, promise });
      }
      if (active.size) { await Promise.race([...active.values()].map(item => item.promise)); continue; }
      // A worker can commit and leave `active` after the state read above.
      // Decide blockage from the transaction's current schedule, never that stale read.
      const latest = await this.require(runId);
      if (latest.version !== state.version || active.size) continue;
      await this.update(runId, current => {
        if (current.status !== "running" || active.size) return;
        const currentSchedule = nextWorkflow(current.workflow);
        if (currentSchedule.complete || currentSchedule.packets.length) return;
        current.status = "blocked"; current.error = currentSchedule.blockedReasons.join("; ") || "No executable step remains"; event(current, "run.blocked", current.error);
      }); return;
    }
  }
  private async executeStep(runId: string, nodeId: string, attemptId: string, controller: AbortController): Promise<void> {
    const state = await this.require(runId), executor = state.spec.executors.find(item => item.nodeId === nodeId)!;
    const deadline = setTimeout(() => controller.abort(), executor.timeoutMs ?? 600000);
    try {
      const prepared = await prepareManagedWorkspace(state.base!, attemptId, dependencyArtifacts(state, nodeId));
      if (controller.signal.aborted) managedFail("AF_RUN_ABORTED", "Worker canceled during preparation");
      await this.update(runId, current => {
        const step = current.steps.find(item => item.attemptId === attemptId)!;
        if (this.closed || controller.signal.aborted || step.status !== "running") return;
        Object.assign(step, prepared); event(current, "attempt.prepared", "Worker input snapshot captured", { nodeId, attemptId });
      });
      const environment = await prepareManagedEnvironment(prepared.directory, { ...state.spec.environment, signal: controller.signal });
      await captureManagedArtifact(state.base!, prepared.directory, [], prepared.inputDigest, environment);
      await this.update(runId, current => {
        const step = current.steps.find(item => item.attemptId === attemptId)!;
        if (this.closed || controller.signal.aborted || step.status !== "running") return;
        step.environment = environment; event(current, "environment.prepared", `Prepared ${environment.manager} dependencies${environment.cacheHit ? " from verified cache" : ""}`, { nodeId, attemptId });
      });
      if (this.closed || controller.signal.aborted) managedFail("AF_RUN_ABORTED", "Worker canceled during environment preparation");
      let report: ManagedStep["report"], usage: ManagedStep["usage"], threadId: string | undefined, outputDigest: string;
      if (executor.type === "codex") {
        const previous = [...state.steps].reverse().find(step => step.nodeId === nodeId && step.threadId);
        const output = await (this.options.worker ?? runCodexWorker)({ cwd: prepared.directory, role: executor.role!, model: executor.model, threadId: previous?.threadId, signal: controller.signal,
          prompt: `${executor.prompt}\n\nTask goal: ${state.spec.goal}\nYour current checkout: ${prepared.directory}\nActual input snapshot: ${prepared.inputDigest}\nWrite scope: ${JSON.stringify(executor.writeScope ?? [])}. Do not change files outside it. Do not commit, publish, deploy, install packages or send external messages. Dependencies already applied to this checkout. Reports from dependencies: ${JSON.stringify(applicableSteps(state).filter(step => state.workflow.nodes.find(node => node.nodeId === nodeId)!.dependsOn.includes(step.nodeId)).map(step => ({ nodeId: step.nodeId, summary: step.summary, report: step.report })))}\nCoordinator instructions for this attempt: ${state.instructions.join("\n")}`,
          onEvent: async notification => {
            if (this.closed || controller.signal.aborted) return;
            await this.update(runId, current => {
              const step = current.steps.find(item => item.attemptId === attemptId);
              if (this.closed || controller.signal.aborted || !step || step.status !== "running") return;
              if (notification.threadId) step.threadId = notification.threadId;
              if (notification.usage) step.usage = notification.usage;
              event(current, notification.type, notification.summary ?? notification.type, { nodeId, attemptId, ...(notification.threadId ? { threadId: notification.threadId } : {}) });
            });
          },
        });
        report = output.report; usage = output.usage; threadId = output.threadId; outputDigest = managedDigest(stableStringify(output.report));
      } else {
        const result = await this.command(prepared.directory, executor.argv!, controller.signal);
        report = { summary: `Command exited successfully; observed output digest ${result.outputDigest}` }; outputDigest = result.outputDigest;
      }
      if (controller.signal.aborted) managedFail("AF_RUN_ABORTED", "Interrupted worker result requires reconciliation");
      const artifact = await captureManagedArtifact(state.base!, prepared.directory, executor.writeScope ?? [], prepared.inputDigest, environment);
      if (Buffer.byteLength(stableStringify(artifact)) > 8 * 1024 * 1024) managedFail("AF_RUN_ARTIFACT_LIMIT", "Artifact exceeds the managed record budget");
      await this.update(runId, current => {
        const step = current.steps.find(item => item.attemptId === attemptId)!;
        if (this.closed || controller.signal.aborted || step.status !== "running") return;
        Object.assign(step, { report, ...(usage ? { usage } : {}), ...(threadId ? { threadId } : {}), artifact, summary: report!.summary });
        const node = current.workflow.nodes.find(item => item.nodeId === nodeId)!;
        if (executor.role === "reviewer" && (report!.verdict !== "approved" || report!.findings?.length)) {
          step.status = "failed"; current.workflow = completeWorkflow(current.workflow, { attemptId, result: { status: "failed", reason: "Independent review requested changes" } });
          current.status = "blocked"; current.error = "Independent review requested changes; coordinator must revise the plan"; event(current, "review.changes_requested", current.error, { nodeId, attemptId }); return;
        }
        const references = [`managed-attempt:${attemptId}`, `input:${prepared.inputDigest}`, `artifact:${artifact.digest}`];
        current.workflow = completeWorkflow(current.workflow, { attemptId, result: { status: "succeeded", outputDigest, evidenceRefs: references,
          evidenceKinds: ["executor-observed"], ...(node.kind === "decision" ? { selectedNodeIds: report!.selectedNodeIds ?? [] } : {}) } });
        step.status = "succeeded"; event(current, "attempt.completed", report!.summary, { nodeId, attemptId });
        if (report!.replanProposal) { current.status = "blocked"; current.error = "Worker proposed a plan change; coordinator decision required"; event(current, "workflow.proposal", report!.replanProposal, { nodeId, attemptId }); }
      });
    } catch (error) {
      if (this.closed) return;
      const interrupted = controller.signal.aborted || (error as { code?: string }).code === "AF_CODEX_ABORTED";
      await this.update(runId, current => {
        const step = current.steps.find(item => item.attemptId === attemptId)!;
        if (step.status !== "running") return;
        step.status = interrupted ? "uncertain" : "failed"; step.summary = errorText(error);
        current.workflow = completeWorkflow(current.workflow, { attemptId, result: { status: step.status, reason: step.summary } });
        if (current.status !== "canceling") current.status = "blocked"; current.error = step.summary;
        event(current, interrupted ? "attempt.uncertain" : "attempt.failed", step.summary, { nodeId, attemptId });
      });
    } finally { clearTimeout(deadline); }
  }
  private command(cwd: string, argv: string[], signal: AbortSignal): Promise<{ outputDigest: string }> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(new Error("Command canceled before dispatch")); return; }
      const child = spawn(argv[0], argv.slice(1), { cwd, env: codexWorkerEnvironment(), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
      const chunks: Buffer[] = []; let bytes = 0, overflow = false, settled = false, grace: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => { if (settled) return; settled = true; if (grace) clearTimeout(grace); signal.removeEventListener("abort", abort); if (error) reject(error); else resolve({ outputDigest: managedDigest(Buffer.concat(chunks).toString("base64")) }); };
      const abort = () => { child.kill(); grace = setTimeout(() => finish(new Error("Command termination is uncertain")), 1000); };
      signal.addEventListener("abort", abort, { once: true });
      const collect = (chunk: Buffer) => { bytes += chunk.length; if (bytes > 1024 * 1024) { overflow = true; child.kill(); } else chunks.push(chunk); };
      child.stdout.on("data", collect); child.stderr.on("data", collect);
      child.on("error", error => finish(error)); child.on("close", code => finish(signal.aborted ? new Error("Command interrupted") : overflow ? new Error("Command output exceeds limit") : code !== 0 ? new Error(`Command failed with exit code ${code}`) : undefined));
    });
  }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    try {
    for (const active of this.workers.values()) for (const worker of active.values()) worker.controller.abort();
    for (const callbacks of this.waiters.values()) for (const callback of callbacks) callback();
    let grace: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.allSettled([...this.loops.values(), ...[...this.workers.values()].flatMap(active => [...active.values()].map(worker => worker.promise))]),
        new Promise<void>(resolve => { grace = setTimeout(resolve, this.options.closeTimeoutMs ?? 1000); }),
      ]);
    } finally { if (grace) clearTimeout(grace); }
    for (const runId of await this.store.list()) {
      const state = await this.require(runId); if (!terminal(state) && state.workflow.runs.some(run => run.status === "running")) await this.update(runId, current => {
        current.workflow = recoverWorkflow(current.workflow, "Owner closed; outcome requires reconciliation");
        for (const step of current.steps.filter(item => item.status === "running")) step.status = "uncertain";
        current.status = "blocked"; event(current, "run.recovered", "Owner closed with unresolved attempts");
      });
      else if (state.status === "publishing") await this.update(runId, current => {
        current.status = "blocked"; current.error = "Owner closed during publication; inspect actual scoped files before reconciliation";
        event(current, "publication.uncertain", current.error);
      });
      else if (["running", "preparing", "canceling"].includes(state.status)) await this.update(runId, current => {
        current.status = "paused"; event(current, "run.paused", "Owner closed; resume dispatch explicitly after restart");
      });
    }
    } finally { if (!this.publicationsInFlight) this.releaseOwner(); }
  }
}
