import { randomUUID } from "node:crypto";
import { readFile, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { ProgramRunStore } from "./program-store.ts";
import { lowerWorkflowSource } from "./program-dsl.ts";
import { prepareProgramWorker, validateProgramCapabilities, type ProgramWorkerAdapter } from "./program-worker.ts";
import { captureManagedBase, previewManagedArtifacts, publishManagedArtifacts, confirmManagedPublication, confirmManagedBaseline, type ManagedBase, type ManagedArtifact } from "./managed-workspace.ts";
import { programAssert, programDigest, programValueBytes, programWithin, programPath, registryEntry, validateProgramData, validateWorkflowProgram, ProgramError,
  type WorkflowProgramV2, type ProgramRegistry, type ProgramOperation, type ProgramExpr, type ProgramRef,
  type ProgramRunV2, type ProgramCandidate, type ProgramAssessment, type ProgramRepairResult } from "./program-contract.ts";

export const PROGRAM_RUN_ACTIONS = ["program-validate", "program-start", "program-status", "program-wait", "program-pause", "program-resume", "program-signal", "program-replan", "program-cancel", "program-reconcile", "program-apply"] as const;
export type ProgramRunAction = typeof PROGRAM_RUN_ACTIONS[number];
interface Context { prefix: string; steps: ProgramOperation[]; program: WorkflowProgramV2; inputRef?: string; parent?: Context; item?: unknown; state?: unknown; depth: number; chain: Set<string>; dependencies?: Set<string> }
interface ActivityOutput { data: unknown; candidate: ProgramCandidate; attemptId: string }
const asRecord = (value: unknown): Record<string, unknown> => { programAssert(value && typeof value === "object" && !Array.isArray(value), "Object required"); return value as Record<string, unknown>; };
const idText = (value: unknown): string => { programAssert(typeof value === "string" && value.length > 0 && value.length <= 256, "ID required"); return value; };
const candidateOf = (value: unknown): ProgramCandidate => { const record = asRecord(value); const candidate = (record.acceptedCandidate ?? record.candidate ?? value) as ProgramCandidate; programAssert(candidate && typeof candidate.digest === "string" && typeof candidate.candidateId === "string", "Candidate reference required"); return candidate; };

/** Templates and decisions are persisted as data; the existing owner hosts this service. */
export class ProgramRunService {
  private active = new Map<string, Promise<void>>();
  private applications = new Map<string, Promise<unknown>>();
  private controllers = new Map<string, AbortController>();
  private attemptControllers = new Map<string, AbortController>();
  private jobs = new Map<string, Promise<unknown>>();
  private workerCount = 0;
  private workerWaiters: (() => void)[] = [];
  private closed = false;
  private constructor(readonly store: ProgramRunStore, private registry: ProgramRegistry, private adapter: ProgramWorkerAdapter) {}
  static async open(root: string, registry?: ProgramRegistry, adapter: ProgramWorkerAdapter = prepareProgramWorker): Promise<ProgramRunService> {
    const store = await ProgramRunStore.open(root);
    if (!registry) {
      try { registry = JSON.parse(await readFile(join(store.root, ".forge/fabric-programs.json"), "utf8")) as ProgramRegistry; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; registry = { schemas: {}, executors: {}, policies: {}, acceptance: {}, populations: {} }; }
    }
    const service = new ProgramRunService(store, registry, adapter);
    for (const id of await store.list()) {
      const run = (await store.read(id))!;
      if (run.status === "applying" || Object.values(run.attempts).some(attempt => attempt.outcome === "running") || Object.values(run.operations).some(operation => operation.status === "running")) {
        await store.transact(id, "owner-recovery", state => {
          const current = state!; if (current.status === "applying") current.status = "apply-uncertain"; else current.status = "needs-attention";
          for (const attempt of Object.values(current.attempts)) if (attempt.outcome === "running") { attempt.outcome = "uncertain"; attempt.reason = "Owner stopped before observed completion"; }
          for (const operation of Object.values(current.operations)) if (operation.status === "running") { operation.status = "uncertain"; operation.reason = "Reconcile interrupted operation before resume"; }
          current.reason = "Recovered incomplete dispatch/application"; return current;
        });
      }
    }
    return service;
  }
  async close(): Promise<void> { this.closed = true; for (const controller of this.controllers.values()) controller.abort(); await Promise.allSettled([...this.active.values(), ...this.applications.values()]); }
  private async state(id: string): Promise<ProgramRunV2> { const state = await this.store.read(id); programAssert(state, "Run not found"); return state; }
  private schedule(id: string): void {
    if (this.closed || this.active.has(id)) return;
    const task = this.run(id).finally(() => { this.active.delete(id); for (const key of this.jobs.keys()) if (key.startsWith(`${id}:`)) this.jobs.delete(key); });
    this.active.set(id, task);
  }
  async execute(action: ProgramRunAction, request: Record<string, unknown>): Promise<unknown> {
    programAssert((PROGRAM_RUN_ACTIONS as readonly string[]).includes(action), "Unsupported program action");
    programAssert(!Object.hasOwn(request, "registry"), "Registry is owner-controlled project configuration, never request data");
    if (action === "program-validate" || action === "program-start") {
      const program = request.source ? lowerWorkflowSource(String(request.source)) : request.program as WorkflowProgramV2;
      validateWorkflowProgram(program, this.registry);
      if (action === "program-validate") return { valid: true, program, programDigest: programDigest(program), registryDigest: programDigest(this.registry) };
      const requestId = idText(request.requestId), fingerprint = programDigest(request), runId = `program-${programDigest(requestId).slice(7, 39)}`;
      const existing = await this.store.read(runId); if (existing) { programAssert(existing.requestDigest === fingerprint, "Start requestId changed", "AF_PROGRAM_CONFLICT"); return existing; }
      validateProgramData(request.input, registryEntry(this.registry.schemas, program.inputSchema));
      const registry = structuredClone(this.registry), policy = registryEntry(registry.policies, program.policy), acceptance = registryEntry(registry.acceptance, program.acceptance);
      const scope = [...new Set([...(policy.captureScope ?? []), ...acceptance.writeScope.filter(path => programWithin(path, policy.writeScope)), ...policy.writeScope.filter(path => programWithin(path, acceptance.writeScope))])];
      let base: ManagedBase | undefined;
      if (this.adapter === prepareProgramWorker) { programAssert(scope.length > 0, "Process program requires an owner-authorized capture scope"); base = await captureManagedBase(this.store.root, runId, scope); }
      const baselineDigest = base?.digest ?? programDigest({ root: this.store.root });
      if (program.population) {
        const population = registryEntry(registry.populations, program.population);
        if (population.inventoryRoots) {
          programAssert(base && population.inventoryRoots.length > 0, "File inventory requires captured source"); const members: string[] = [];
          const walk = async (path: string, depth: number): Promise<void> => {
            programPath(path); programAssert(depth <= policy.maxDepth && programWithin(path, scope), "Inventory exceeds captured scope/depth"); const stat = await lstat(join(base!.baselineDirectory, path));
            programAssert(!stat.isSymbolicLink(), "Inventory symlink rejected");
            if (stat.isDirectory()) for (const name of (await readdir(join(base!.baselineDirectory, path))).sort()) await walk(`${path}/${name}`, depth + 1);
            else if (stat.isFile() && (!population.extensions?.length || population.extensions.some(extension => path.endsWith(extension)))) { members.push(path); programAssert(members.length <= policy.maxItems, "Inventory item limit exceeded"); }
          };
          for (const root of population.inventoryRoots) await walk(root, 0);
          population.members = [...new Set(members)].sort(); population.baselineDigest = baselineDigest; population.evidence = "owner-observed/files-v1: captured baseline and configured inventory roots/extensions";
        }
        programAssert(population.baselineDigest === baselineDigest, "Population inventory does not match captured baseline");
      }
      const inputRef = await this.store.put(request.input, policy.maxOutputBytes), baseRef = base ? await this.store.put(base) : undefined;
      const now = new Date();
      const run = await this.store.transact(runId, "start", () => ({ schemaVersion: 2, runId, requestId, requestDigest: fingerprint,
        program, registry, programDigest: programDigest(program), registryDigest: programDigest(registry),
        inputRef, baselineDigest, ...(baseRef ? { baseRef } : {}), createdAt: now.toISOString(), deadlineAt: new Date(now.getTime() + policy.deadlineMs).toISOString(),
        version: 0, semanticVersion: 1, revision: 1, planRevision: 1, status: "executing", operations: {}, attempts: {}, seals: {}, signals: [], candidates: {}, assessments: {}, coverageReceipts: {}, deltas: {}, waits: {}, repairs: {}, collections: {}, totalAttempts: 0 }), { requestId, fingerprint, expectedVersion: 0 });
      this.schedule(runId); return run;
    }
    const runId = idText(request.runId);
    if (action === "program-status") return this.state(runId);
    if (action === "program-wait") {
      const waitMs = Math.min(30000, Math.max(0, Number(request.waitMs ?? 1000))); programAssert(Number.isFinite(waitMs), "Invalid wait duration");
      const until = Date.now() + waitMs; let state = await this.state(runId);
      while (state.version === request.cursor && Date.now() < until && !this.closed) { await new Promise(resolve => setTimeout(resolve, 25)); state = await this.state(runId); }
      return state;
    }
    if (action === "program-apply") {
      const running = this.applications.get(runId); if (running) { await running; return this.apply(runId, request); }
      const task = this.apply(runId, request).finally(() => this.applications.delete(runId)); this.applications.set(runId, task); return task;
    }
    if (action === "program-signal") {
      programAssert(typeof request.authorization === "string" && request.authorization.length > 0, "Signal requires host authorization provenance");
      request = { ...request, payloadRef: await this.store.put(request.payload) }; delete request.payload;
    }
    if (action === "program-reconcile" && (request.publication === true || request.publication === "retry")) return this.reconcileApply(runId, request);
    const state = await this.store.transact(runId, action, current => {
      programAssert(current, "Run not found");
      programAssert(current.status !== "applied" && (current.status !== "canceled" || action === "program-reconcile"), "Terminal runs require an explicit successor");
      if (current.status === "applying" || current.status === "apply-uncertain") {
        programAssert(action === "program-signal" || action === "program-cancel", "Apply intent frozen; reconcile before changing execution");
      }
      if (action === "program-pause") current.status = "paused";
      else if (action === "program-resume") {
        programAssert(!this.active.has(runId), "Wait for the current scheduler cycle to stop before resume");
        programAssert(!Object.values(current.attempts).some(attempt => attempt.outcome === "uncertain" || attempt.outcome === "running") && !Object.values(current.operations).some(operation => operation.status === "uncertain"), "Active/uncertain work requires observation or reconciliation");
        current.status = "executing"; delete current.reason;
        // Keep fenced generations and previous diagnostic outputs; materialize decides compatible reuse.
      } else if (action === "program-cancel") {
        if (current.intent && ["applying", "apply-uncertain"].includes(current.status)) { current.status = "apply-uncertain"; current.reason = "Cancellation requested; verify actual files"; }
        else { current.status = Object.values(current.attempts).some(attempt => attempt.outcome === "running" || attempt.outcome === "uncertain") ? "paused" : "canceled"; current.reason = "Cancellation requested; active effects still require observed completion"; }
      } else if (action === "program-signal") {
        programAssert(current.status !== "acceptance-ready", "Result already gated; explicitly pause/replan before steering");
        programAssert(current.signals.length < 1000 && request.payloadRef && /^sha256:[a-f0-9]{64}$/.test(String(request.payloadRef)), "Persisted signal payload reference required");
        programAssert(Number.isSafeInteger(request.generation) && Number(request.generation) > 0 && (!request.expiresAt || Number.isFinite(Date.parse(String(request.expiresAt)))), "Invalid signal generation/expiry");
        current.signals.push({ id: idText(request.signalId), target: idText(request.target), generation: Number(request.generation), type: idText(request.type), correlation: idText(request.correlation), payloadRef: String(request.payloadRef), ...(request.expiresAt ? { expiresAt: String(request.expiresAt) } : {}), status: current.status === "applying" || current.status === "apply-uncertain" ? "pending-after-apply" : "pending" });
        programAssert(new Set(current.signals.map(signal => signal.id)).size === current.signals.length, "Duplicate signal ID");
      } else if (action === "program-replan") {
        const program = request.source ? lowerWorkflowSource(String(request.source)) : request.program as WorkflowProgramV2;
        validateWorkflowProgram(program, current.registry);
        programAssert(current.planRevision < 20 && program.id === current.program.id && programDigest(program.inputSchema) === programDigest(current.program.inputSchema) && programDigest(program.outputSchema) === programDigest(current.program.outputSchema) && programDigest(program.acceptance) === programDigest(current.program.acceptance) && programDigest(program.policy) === programDigest(current.program.policy) && programDigest(program.population ?? null) === programDigest(current.program.population ?? null), "Replan cannot weaken external contracts or exceed revision limits");
        if (request.mode === "additive") {
          programAssert(current.program.steps.every(old => program.steps.some(step => step.id === old.id && programDigest(step) === programDigest(old))), "Additive replan cannot replace existing templates");
        } else if (request.mode === "fenced") {
          programAssert(registryEntry(current.registry.policies, current.program.policy).allowFencedReplan, "Online replacement is disabled by owner policy");
          const changed = new Set(current.program.steps.filter(old => !program.steps.some(step => step.id === old.id && programDigest(step) === programDigest(old))).map(step => step.id));
          programAssert(changed.size > 0, "Fenced replan requires changed templates");
          const affected = new Set(Object.keys(current.operations).filter(id => [...changed].some(root => id === root || id.startsWith(`${root}/`))));
          let grew = true; while (grew) { grew = false; for (const operation of Object.values(current.operations)) if (!affected.has(operation.id) && (operation.dependencies?.some(dependency => affected.has(dependency)) || [...affected].some(parent => operation.id.startsWith(`${parent}/`)))) { affected.add(operation.id); grew = true; } }
          for (const id of affected) { const operation = current.operations[id]; operation.generation++; operation.retired = true; operation.status = operation.status === "running" || operation.status === "uncertain" ? "uncertain" : "skipped"; delete current.seals[id]; delete current.collections[id]; }
          for (const attempt of Object.values(current.attempts)) if (affected.has(attempt.operationId) && attempt.outcome === "running") { attempt.outcome = "uncertain"; attempt.reason = "Fenced attempt: observe its process/effects before retry"; }
          current.status = "paused";
        } else {
          programAssert(request.mode === undefined || request.mode === "barrier", "Unknown replan mode");
          programAssert(!Object.values(current.attempts).some(attempt => attempt.outcome === "running" || attempt.outcome === "uncertain") && !Object.values(current.operations).some(operation => operation.status === "running" || operation.status === "uncertain"), "Replan barrier: observe/reconcile affected workers and controls first");
          current.revision++; current.status = "paused";
        }
        current.program = program; current.programDigest = programDigest(program); current.planRevision++; current.semanticVersion++;
        delete current.gateRef; delete current.acceptedCandidate; delete current.resultRef;
      } else if (action === "program-reconcile") {
        programAssert(request.resolution === "failed" && typeof request.reason === "string" && request.reason.length > 0, "Reconciliation requires observed failure/effect evidence");
        if (request.operationId) {
          const operation = current.operations[idText(request.operationId)]; programAssert(operation?.status === "uncertain" && !Object.values(current.attempts).some(attempt => (attempt.operationId === operation.id || attempt.operationId.startsWith(`${operation.id}/`)) && (attempt.outcome === "running" || attempt.outcome === "uncertain")), "Observe/reconcile worker attempts first");
          operation.status = operation.retired ? "skipped" : "needs-attention"; operation.reason = String(request.reason); return current;
        }
        const attempt = current.attempts[idText(request.attemptId)]; programAssert(attempt?.outcome === "uncertain", "Only uncertain attempts can be reconciled");
        attempt.outcome = "infrastructure_failed"; attempt.reason = String(request.reason);
        const operation = current.operations[attempt.operationId]; if (operation) { operation.status = operation.retired ? "skipped" : "needs-attention"; operation.reason = String(request.reason); }
      }
      return current;
    }, { requestId: idText(request.requestId), fingerprint: programDigest(request), expectedVersion: Number(request.expectedVersion) });
    if (action === "program-cancel") this.controllers.get(runId)?.abort();
    if (action === "program-replan" && request.mode === "fenced") for (const attempt of Object.values(state.attempts)) if (attempt.outcome === "uncertain") this.attemptControllers.get(attempt.attemptId)?.abort();
    if (action === "program-resume") this.schedule(runId);
    return state;
  }
  private async run(runId: string): Promise<void> {
    const controller = new AbortController(); this.controllers.set(runId, controller);
    try {
      let state: ProgramRunV2, context: Context;
      for (;;) {
        state = await this.state(runId); context = { prefix: "", steps: state.program.steps, program: state.program, inputRef: state.inputRef, depth: 0, chain: new Set() };
        for (const step of context.steps) await this.ensure(runId, step, context);
        if ((await this.state(runId)).programDigest === state.programDigest) break;
        // All roots of the previous cycle have settled. Recompute controls/gates for the new
        // semantic version; activity preparation may then issue explicit compatible reuse receipts.
        for (const key of this.jobs.keys()) if (key.startsWith(`${runId}:`)) this.jobs.delete(key);
      }
      const result = await this.evaluate(runId, state.program.result, context);
      validateProgramData(result, registryEntry(state.registry.schemas, state.program.outputSchema));
      const final = await this.state(runId), data = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : undefined;
      programAssert(!Object.values(final.attempts).some(attempt => attempt.outcome === "running" || attempt.outcome === "uncertain") && !Object.values(final.operations).some(operation => operation.status === "running" || operation.status === "uncertain"), "Unsettled work cannot complete the program");
      if (data?.status === "accepted") programAssert(final.gateRef && final.acceptedCandidate, "Accepted result requires current owner gate");
      if (final.gateRef && (data?.candidate || data?.acceptedCandidate)) programAssert(this.resolveCandidate(final, data.candidate ?? data.acceptedCandidate).digest === final.acceptedCandidate?.digest, "Result candidate differs from the owner acceptance gate");
      const resultRef = await this.store.put(result, registryEntry(state.registry.policies, state.program.policy).maxOutputBytes);
      await this.store.transact(runId, "program-result", current => { programAssert(current?.status === "executing" && current.programDigest === state.programDigest && current.semanticVersion === state.semanticVersion, "Execution paused, canceled or revised"); current.resultRef = resultRef; current.status = current.gateRef ? "acceptance-ready" : "completed"; return current; });
    } catch (error) {
      await this.store.transact(runId, "execution-stopped", current => {
        const state = current!;
        if (state.status === "executing") { state.status = "needs-attention"; state.reason = (error as Error).message.slice(0, 1000); }
        return state;
      }).catch(() => {});
    } finally { this.controllers.delete(runId); }
  }
  private async checkRunning(runId: string): Promise<ProgramRunV2> {
    const state = await this.state(runId);
    programAssert(!this.closed && state.status === "executing" && Date.now() < Date.parse(state.deadlineAt), "Run paused, canceled, or deadline exceeded", "AF_PROGRAM_STOPPED"); return state;
  }
  private async reference(runId: string, id: string, context: Context): Promise<unknown> {
    const step = context.steps.find(operation => operation.id === id);
    if (step) { context.dependencies?.add(`${context.prefix}${id}`); return this.ensure(runId, step, context); }
    if (context.parent) return this.reference(runId, id, { ...context.parent, dependencies: context.dependencies });
    programAssert(false, `Unknown output ${id}`);
  }
  private async evaluate(runId: string, value: unknown, context: Context): Promise<unknown> {
    const runState = await this.state(runId), limits = registryEntry(runState.registry.policies, context.program.policy);
    const evaluateMany = async (entries: unknown[]): Promise<unknown[]> => {
      programAssert(entries.length <= 10000, "Expression operand budget exceeded"); const values: unknown[] = []; let bytes = 0;
      for (const entry of entries) { const result = await this.evaluate(runId, entry, context); bytes += programValueBytes(result, limits.maxOutputBytes, limits.maxItems); programAssert(bytes <= limits.maxOutputBytes, "Expression expansion byte budget exceeded"); values.push(result); }
      return values;
    };
    if (Array.isArray(value)) return evaluateMany(value);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (!Object.hasOwn(object, "$expr")) { const entries = Object.entries(object), values = await evaluateMany(entries.map(([, entry]) => entry)); const result = Object.fromEntries(entries.map(([key], index) => [key, values[index]])); programValueBytes(result, limits.maxOutputBytes, limits.maxItems); return result; }
    const expression = object as unknown as ProgramExpr; programAssert(Array.isArray(expression.args), "Invalid expression");
    const name = expression.$expr, args = expression.args;
    if (name === "literal") return args[0];
    if (name === "workflowInput") return this.store.get(context.inputRef ?? (await this.state(runId)).inputRef);
    if (name === "item") return context.item;
    if (name === "loopState") return context.state;
    if (["output", "acceptedCandidate", "acceptedCandidates", "outputCandidate", "coverageReceipt"].includes(name)) {
      const output = await this.reference(runId, idText(args[0]), context);
      if (name === "output") { const record = output && typeof output === "object" ? output as Record<string, unknown> : undefined; return record && Object.hasOwn(record, "data") && Object.hasOwn(record, "attemptId") ? record.data : output; }
      if (name === "coverageReceipt") return asRecord(output).coverage;
      if (name === "acceptedCandidate") { programAssert(asRecord(output).status === "accepted", "Repair candidate not accepted"); return candidateOf(output); }
      if (name === "outputCandidate") return candidateOf(output);
      const results = asRecord(output).results; programAssert(Array.isArray(results), "Map results required");
      return results.map(result => { programAssert(asRecord(result).status === "accepted", "Map contains unaccepted candidate"); return candidateOf(result); });
    }
    const run = await this.state(runId);
    if (name === "population") { programAssert(context.program.population, "Population contract required"); return registryEntry(run.registry.populations, context.program.population); }
    if (name === "acceptance") return registryEntry(run.registry.acceptance, context.program.acceptance);
    if (name === "acceptanceWriteScope") return registryEntry(run.registry.acceptance, context.program.acceptance).writeScope;
    if (name === "acceptanceChecks" || name === "approvedChecksFor") return registryEntry(run.registry.acceptance, context.program.acceptance).requiredChecks;
    if (name === "candidateFromBaseline") return this.initialCandidate(runId);
    const values = await evaluateMany(args);
    if (name === "object") return values[0]; if (name === "array") return values;
    if (name === "field") { const data = asRecord(values[0]), key = idText(values[1]); programAssert(Object.hasOwn(data, key), `Field absent ${key}`); return data[key]; }
    if (name === "eq") return programDigest(values[0]) === programDigest(values[1]);
    if (name === "and") return values.every(Boolean); if (name === "or") return values.some(Boolean); if (name === "not") return !values[0];
    if (name === "length") { programAssert(Array.isArray(values[0]) || typeof values[0] === "string", "Length requires collection"); return values[0].length; }
    if (name === "concat") { programAssert(values.every(Array.isArray) && (values as unknown[][]).reduce((total, entries) => total + entries.length, 0) <= limits.maxItems, "Concat item budget exceeded"); return (values as unknown[][]).flat(); }
    if (name === "coverageFor") return this.coverage(run, asRecord(values[0]), values[1]);
    programAssert(Array.isArray(values[0]), "Transform requires array"); const data = values[0] as unknown[], key = String(values[1]);
    const policy = registryEntry(run.registry.policies, context.program.policy); programAssert(data.length <= policy.maxItems, "Transform item limit exceeded");
    if (name === "filter") return data.filter(entry => programDigest(asRecord(entry)[key]) === programDigest(values[2]));
    if (name === "unique") { const seen = new Set<string>(); return data.filter(entry => { const id = programDigest(asRecord(entry)[key]); if (seen.has(id)) return false; seen.add(id); return true; }); }
    if (name === "sort") return [...data].sort((a, b) => String(asRecord(a)[key]).localeCompare(String(asRecord(b)[key]), "en"));
    if (name === "take") { programAssert(Number.isSafeInteger(values[1]) && Number(values[1]) >= 0, "Take count invalid"); return data.slice(0, Number(values[1])); }
    programAssert(false, `Unknown expression ${name}`);
  }
  private async ensure(runId: string, step: ProgramOperation, context: Context): Promise<unknown> {
    const id = `${context.prefix}${step.id}`;
    programAssert(!context.chain.has(id), `Dependency cycle at ${id}`);
    const jobKey = `${runId}:${id}`;
    if (this.jobs.has(jobKey)) return this.jobs.get(jobKey)!;
    const promise = this.materialize(runId, step, { ...context, chain: new Set([...context.chain, id]) }, id);
    this.jobs.set(jobKey, promise); return promise;
  }
  private async materialize(runId: string, step: ProgramOperation, context: Context, id: string): Promise<unknown> {
    const run = await this.checkRunning(runId), policy = registryEntry(run.registry.policies, context.program.policy);
    programAssert(context.depth <= policy.maxDepth, "Invocation depth exceeded");
    const excluded = new Set(["body", "then", "else", "result", "until", "next", "key"]);
    const dependencies = new Set<string>(); context = { ...context, dependencies };
    const input = await this.evaluate(runId, Object.fromEntries(Object.entries(step.options).filter(([key]) => !excluded.has(key))), context) as Record<string, unknown>;
    const semanticDigest = programDigest(step), inputDigest = programDigest({ input, baselineDigest: run.baselineDigest, programInput: context.inputRef ?? run.inputRef, ...(context.item === undefined ? {} : { item: context.item }), ...(context.state === undefined ? {} : { state: context.state }) });
    const existing = (await this.state(runId)).operations[id];
    const targetGeneration = Math.max(existing?.generation ?? 0, run.revision);
    if (existing?.status === "completed" && existing.semanticDigest === semanticDigest && existing.inputDigest === inputDigest && existing.outputRef && (step.kind === "value" || step.kind === "waitEvent" && existing.generation === targetGeneration)) {
      if (existing.generation !== targetGeneration) await this.store.transact(runId, "operation-reuse-receipt", current => { const record = current!.operations[id]; record.reusedFromGeneration = record.generation; record.generation = Math.max(record.generation, targetGeneration); return current!; });
      return this.store.get(existing.outputRef);
    }
    programAssert(existing?.status !== "uncertain", "Operation requires reconciliation");
    await this.store.transact(runId, "materialize", current => {
      programAssert(current?.status === "executing", "Run stopped"); programAssert(Object.keys(current.operations).length < policy.maxOperations || current.operations[id], "Operation limit exceeded");
      current.operations[id] = { id, kind: step.kind, semanticDigest, inputDigest, dependencies: [...dependencies], generation: targetGeneration, status: "running", attempts: existing?.attempts ?? [] }; return current;
    });
    try {
      const output = await this.operation(runId, step, input, context, id), outputRef = await this.store.put(output, policy.maxOutputBytes);
      await this.store.transact(runId, "operation-result", current => {
        programAssert(current?.operations[id]?.generation === targetGeneration, "Fenced operation result"); current.operations[id].status = "completed"; current.operations[id].outputRef = outputRef; return current;
      });
      if (step.kind === "repair") programAssert(asRecord(output).status === "accepted", `Repair ${id} ended ${asRecord(output).status}`, "AF_PROGRAM_REPAIR_STOPPED");
      return output;
    } catch (error) {
      await this.store.transact(runId, "operation-stopped", current => {
        const operation = current!.operations[id]; if (operation && operation.generation === targetGeneration && operation.status !== "uncertain") { operation.status = Object.values(current!.attempts).some(attempt => (attempt.operationId === id || attempt.operationId.startsWith(`${id}/`)) && attempt.outcome === "uncertain") ? "uncertain" : "needs-attention"; operation.reason = (error as Error).message.slice(0, 1000); } return current!;
      }); throw error;
    }
  }
  private async coverage(run: ProgramRunV2, population: Record<string, unknown>, discovered: unknown): Promise<unknown> {
    const contract = run.program.population ? registryEntry(run.registry.populations, run.program.population) : undefined;
    programAssert(contract && programDigest(population) === programDigest(contract) && contract.baselineDigest === run.baselineDigest, "Coverage contract mismatch");
    const items = Array.isArray(discovered) ? discovered : asRecord(discovered).items; programAssert(Array.isArray(items), "Discovered items required");
    const ids = items.map(item => idText(asRecord(item).id)); programAssert(new Set(ids).size === ids.length, "Duplicate discovered item");
    const exclusions = new Set(contract.exclusions.map(entry => { programAssert(entry.reason.length > 0 && contract.members.includes(entry.id), "Invalid exclusion"); return entry.id; }));
    const expected = contract.members.filter(id => !exclusions.has(id));
    programAssert(programDigest([...ids].sort()) === programDigest([...expected].sort()), "Discovery does not cover owner population");
    if (!ids.length) programAssert(contract.allowNoWork && registryEntry(run.registry.acceptance, run.program.acceptance).allowNoWork, "Empty population cannot approve by vacuity");
    const receipt = { status: ids.length ? "covered" : "no-work", populationDigest: programDigest(contract), baselineDigest: run.baselineDigest, ids: [...ids].sort(), exclusions: contract.exclusions, evidence: contract.evidence };
    const receiptId = await this.store.put(receipt);
    await this.store.transact(run.runId, "coverage-receipt", current => { current!.coverageReceipts[receiptId] = receipt; return current!; });
    return { ...receipt, receiptId };
  }
  private async initialCandidate(runId: string): Promise<ProgramCandidate> {
    const run = await this.state(runId), candidate: ProgramCandidate = { candidateId: `candidate-${run.baselineDigest.slice(7, 39)}`, digest: run.baselineDigest, baselineDigest: run.baselineDigest, parents: [], deltas: [], producerAttempts: [] };
    await this.store.transact(runId, "baseline-candidate", current => { current!.candidates[candidate.candidateId] = candidate; return current!; }); return candidate;
  }
  private resolveCandidate(run: ProgramRunV2, reference: unknown): ProgramCandidate {
    const candidate = candidateOf(reference), registered = run.candidates[candidate.candidateId];
    programAssert(registered && programDigest(registered) === programDigest(candidate), "Candidate must match its immutable owner record"); return registered;
  }
  private async artifacts(runId: string, candidate: ProgramCandidate): Promise<ManagedArtifact[]> {
    const run = await this.state(runId); this.resolveCandidate(run, candidate);
    const artifacts: ManagedArtifact[] = []; for (const ref of candidate.deltas) { const delta = run.deltas[ref]; programAssert(delta, "Delta does not belong to this run"); artifacts.push(await this.store.get<ManagedArtifact>(delta.artifactRef)); } return artifacts;
  }
  private async activity(runId: string, id: string, ref: ProgramRef, data: unknown, candidate: ProgramCandidate, requestedScope: string[]): Promise<ActivityOutput> {
    const run = await this.checkRunning(runId), executor = registryEntry(run.registry.executors, ref), policy = registryEntry(run.registry.policies, run.program.policy), acceptance = registryEntry(run.registry.acceptance, run.program.acceptance);
    candidate = this.resolveCandidate(run, candidate);
    const scope = validateProgramCapabilities(executor, policy, acceptance, requestedScope), attemptId = `attempt-${randomUUID()}`;
    while (this.workerCount >= policy.concurrency) await new Promise<void>(resolve => this.workerWaiters.push(resolve)); this.workerCount++;
    let timeout: ReturnType<typeof setTimeout> | undefined, removeAbort: (() => void) | undefined;
    try {
      await this.checkRunning(runId);
      const controller = new AbortController(), parent = this.controllers.get(runId); const abort = () => controller.abort(); parent?.signal.addEventListener("abort", abort, { once: true });
      removeAbort = () => parent?.signal.removeEventListener("abort", abort); if (parent?.signal.aborted) abort();
      this.attemptControllers.set(attemptId, controller);
      timeout = setTimeout(abort, Math.min(executor.timeoutMs, Math.max(1, Date.parse(run.deadlineAt) - Date.now())));
      const base = run.baseRef ? await this.store.get<ManagedBase>(run.baseRef) : undefined;
      const preparation = await this.adapter({ executor, data, candidate, artifacts: await this.artifacts(runId, candidate), base, attemptId, scope, signal: controller.signal, registry: run.registry,
        onThread: async threadId => { await this.store.transact(runId, "worker-thread", current => { current!.attempts[attemptId].threadId = threadId; return current!; }); } });
      const inputDigest = programDigest({ preparation: preparation.inputDigest, executor, data, candidate: candidate.digest, acceptance, policy });
      await this.store.transact(runId, "activity-materialize", current => {
        programAssert(current?.status === "executing" && !controller.signal.aborted, "Preparation stopped before dispatch");
        const parentGeneration = Object.values(current!.operations).filter(operation => id.startsWith(`${operation.id}/`)).reduce((generation, operation) => Math.max(generation, operation.generation), current!.revision);
        const old = current!.operations[id];
        current!.operations[id] = { id, kind: old?.kind ?? "activity", semanticDigest: programDigest(executor), inputDigest, generation: Math.max(old?.generation ?? 0, parentGeneration), status: "running", attempts: old?.attempts ?? [], ...(old?.dependencies ? { dependencies: old.dependencies } : {}) }; return current!;
      });
      // Completed compatible attempts can be attached to a new generation by an explicit reuse receipt.
      const compatible = preparation.reusable ? Object.values((await this.state(runId)).attempts).find(attempt => attempt.operationId === id && attempt.outcome === "completed" && attempt.inputDigest === inputDigest && attempt.outputRef) : undefined;
      if (compatible) {
        await this.store.transact(runId, "attempt-reuse-receipt", current => { programAssert(current?.status === "executing", "Reuse stopped"); const operation = current.operations[id]; if (!operation.attempts.includes(compatible.attemptId)) operation.attempts.push(compatible.attemptId); operation.reusedFromGeneration = compatible.generation; operation.status = "completed"; operation.outputRef = compatible.outputRef; return current; });
        return this.store.get<ActivityOutput>(compatible.outputRef!);
      }
      await this.store.transact(runId, "attempt-dispatch-intent", current => {
        programAssert(current?.status === "executing" && current.totalAttempts < policy.maxAttempts, "Attempt budget exhausted or run stopped");
        current.totalAttempts++; current.attempts[attemptId] = { attemptId, operationId: id, generation: current.operations[id].generation, inputDigest, executorDigest: programDigest(executor), outcome: "running", startedAt: new Date().toISOString() };
        current.operations[id].attempts.push(attemptId); return current;
      });
      const result = await preparation.execute(); clearTimeout(timeout); parent?.signal.removeEventListener("abort", abort);
      if (result.outcome !== "completed") {
        await this.store.transact(runId, "attempt-failed", current => { const attempt = current!.attempts[attemptId]; if (attempt.outcome === "running" && attempt.generation === current!.operations[id].generation) { attempt.outcome = result.outcome; attempt.completedAt = new Date().toISOString(); attempt.reason = result.reason ?? result.outcome; } return current!; });
        throw new ProgramError("AF_PROGRAM_ACTIVITY", result.reason ?? result.outcome);
      }
      validateProgramData(result.data, registryEntry(run.registry.schemas, executor.schema));
      let next = candidate;
      let deltaRecord: ProgramRunV2["deltas"][string] | undefined, deltaId: string | undefined;
      if (result.artifact?.files.length) {
        programAssert(executor.effect === "isolated-write", "Readonly activity changed candidate");
        const deltaRef = await this.store.put(result.artifact, 32 * 1024 * 1024); deltaId = `delta-${attemptId}`; const deltas = [...candidate.deltas, deltaId];
        const digest = base ? (await previewManagedArtifacts(base, [...await this.artifacts(runId, candidate), result.artifact])).digest : programDigest({ parent: candidate.digest, artifact: result.artifact });
        deltaRecord = { artifactRef: deltaRef, inputCandidateDigest: candidate.digest, outputCandidateDigest: digest, producerAttemptId: attemptId };
        next = { candidateId: `candidate-${programDigest({ digest, attemptId }).slice(7, 39)}`, digest, baselineDigest: run.baselineDigest, parents: [candidate.candidateId], deltas, producerAttempts: [...candidate.producerAttempts, attemptId] };
      }
      const output: ActivityOutput = { data: result.data, candidate: next, attemptId }, outputRef = await this.store.put(output, policy.maxOutputBytes);
      await this.store.transact(runId, "attempt-result", current => {
        const attempt = current!.attempts[attemptId]; programAssert(attempt.outcome === "running" && attempt.generation === current!.operations[id].generation, "Fenced attempt result"); attempt.outcome = "completed"; attempt.completedAt = new Date().toISOString(); attempt.outputRef = outputRef;
        if (deltaId && deltaRecord) current!.deltas[deltaId] = deltaRecord;
        if (result.usage !== undefined) attempt.usage = result.usage;
        if (current!.candidates[next.candidateId]) programAssert(programDigest(current!.candidates[next.candidateId]) === programDigest(next), "Candidate record cannot be overwritten"); else current!.candidates[next.candidateId] = next;
        const operation = current!.operations[id]; operation.status = "completed"; operation.outputRef = outputRef; return current!;
      }); return output;
    } catch (error) {
      await this.store.transact(runId, "dispatch-uncertainty", current => { const attempt = current!.attempts[attemptId]; if (attempt?.outcome === "running") { attempt.outcome = "uncertain"; attempt.reason = (error as Error).message.slice(0, 1000); current!.operations[id].status = "uncertain"; } return current!; }); throw error;
    } finally { if (timeout) clearTimeout(timeout); removeAbort?.(); this.attemptControllers.delete(attemptId); this.workerCount--; this.workerWaiters.shift()?.(); }
  }
  private async operation(runId: string, step: ProgramOperation, input: Record<string, unknown>, context: Context, id: string): Promise<unknown> {
    const run = await this.state(runId), policy = registryEntry(run.registry.policies, context.program.policy);
    if (step.kind === "value") return input.value;
    if (step.kind === "agent" || step.kind === "command") return this.activity(runId, id, input.executor as ProgramRef, input.input ?? {}, input.candidate ? candidateOf(input.candidate) : await this.initialCandidate(runId), (input.writeScope ?? []) as string[]);
    if (step.kind === "map") {
      programAssert(Array.isArray(input.items) && input.items.length <= policy.maxItems, "Map items exceed policy");
      const items = input.items as unknown[], keys: string[] = [];
      for (const item of items) { const key = idText(await this.evaluate(runId, step.options.key, { ...context, item })); programAssert(key === key.normalize("NFC"), "Map key must use canonical NFC normalization"); keys.push(key); }
      programAssert(new Set(keys).size === keys.length, "Map keys must be unique");
      if (input.completion === "all-required") {
        const coverage = asRecord(input.coverage), registered = (await this.state(runId)).coverageReceipts[String(coverage.receiptId)];
        programAssert(registered && programDigest(Object.fromEntries(Object.entries(coverage).filter(([key]) => key !== "receiptId"))) === programDigest(registered) && programDigest([...keys].sort()) === programDigest(registered.ids), "All-required map needs owner coverage matching its items");
      }
      const seal = await this.store.put({ ids: [...keys].sort(), collectionDigest: programDigest(input.items), coverage: input.coverage ?? null });
      await this.store.transact(runId, "collection-seal", current => { current!.seals[id] = seal; return current!; });
      const body = Array.isArray(step.options.body) ? step.options.body as ProgramOperation[] : [step.options.body as ProgramOperation], results: unknown[] = new Array(items.length); let cursor = 0;
      const concurrency = Math.min(policy.concurrency, Number(input.concurrency ?? policy.concurrency)); programAssert(Number.isSafeInteger(concurrency) && concurrency > 0, "Invalid map concurrency");
      const failures: { id: string; reason: string }[] = [];
      await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        for (;;) { const index = cursor++; if (index >= items.length) return;
          const child: Context = { prefix: `${id}/${encodeURIComponent(keys[index])}/`, steps: body, program: context.program, inputRef: context.inputRef, parent: context, item: items[index], depth: context.depth + 1, chain: new Set(context.chain) };
          try { for (const operation of body) results[index] = await this.ensure(runId, operation, child); }
          catch (error) { failures.push({ id: keys[index], reason: (error as Error).message }); results[index] = { status: "failed", reason: (error as Error).message }; }
        }
      }));
      if (input.completion === "all-required") programAssert(!failures.length && results.every(result => !result || typeof result !== "object" || !Object.hasOwn(result, "status") || asRecord(result).status === "accepted"), `Required map item failed/unaccepted: ${failures.slice(0, 3).map(failure => `${failure.id}: ${failure.reason}`).join("; ")}`);
      programAssert(!Object.values((await this.state(runId)).attempts).some(attempt => attempt.operationId.startsWith(`${id}/`) && attempt.outcome === "uncertain"), "Map has uncertain effects");
      if (input.completion === "quorum") programAssert(results.length - failures.length >= Number(input.quorum), "Quorum not reached");
      const completed = await this.state(runId), acceptedAssessmentIds: string[] = [], acceptedCandidateIds: string[] = []; let obligationsSatisfied = !failures.length;
      for (const key of keys) {
        const prefix = `${id}/${encodeURIComponent(key)}/`, repairs = Object.values(completed.operations).filter(operation => operation.id.startsWith(prefix) && operation.kind === "repair" && !operation.retired && operation.status !== "skipped");
        if (!repairs.length) obligationsSatisfied = false;
        for (const operation of repairs) {
          const result = operation.outputRef ? asRecord(await this.store.get(operation.outputRef)) : {};
          const assessment = result.assessment as ProgramAssessment | undefined;
          if (operation.status !== "completed" || result.status !== "accepted" || !assessment?.receiptId || !completed.assessments[assessment.receiptId]) obligationsSatisfied = false;
          else { acceptedAssessmentIds.push(assessment.receiptId); acceptedCandidateIds.push(this.resolveCandidate(completed, result.acceptedCandidate).candidateId); }
        }
      }
      await this.store.transact(runId, "collection-completion", current => { programAssert(current!.seals[id] === seal, "Collection seal changed"); current!.collections[id] = { seal, coverageReceiptId: input.coverage ? String(asRecord(input.coverage).receiptId) : null, generation: current!.operations[id].generation, ids: [...keys].sort(), acceptedAssessmentIds, acceptedCandidateIds, obligationsSatisfied }; return current!; });
      return { results, failures, seal, coverage: input.coverage ?? null, status: failures.length ? "partial" : items.length ? "completed" : "no-work" };
    }
    if (step.kind === "branch") {
      const selected = input.condition ? "then" : "else", skipped = input.condition ? "else" : "then";
      const body = step.options[selected] as ProgramOperation[], child: Context = { ...context, prefix: `${id}/${selected}/`, steps: body, parent: context, depth: context.depth + 1, chain: new Set(context.chain) };
      await this.store.transact(runId, "branch-selection", current => { for (const record of Object.values(current!.operations)) if (record.id.startsWith(`${id}/${skipped}/`)) { programAssert(!Object.values(current!.attempts).some(attempt => attempt.operationId === record.id && ["running", "uncertain"].includes(attempt.outcome)), "Skipped branch still has unobserved effects"); record.status = "skipped"; record.retired = true; }
        for (const operation of step.options[skipped] as ProgramOperation[]) { const path = `${id}/${skipped}/${operation.id}`, old = current!.operations[path]; current!.operations[path] = { ...old, id: path, semanticDigest: programDigest(operation), inputDigest: programDigest(null), generation: Math.max(old?.generation ?? 0, current!.revision), status: "skipped", attempts: old?.attempts ?? [] }; } return current!; });
      let result: unknown = null; for (const operation of body) result = await this.ensure(runId, operation, child); return result;
    }
    if (step.kind === "loop") {
      const maxRounds = Number(input.maxRounds); programAssert(Number.isSafeInteger(maxRounds) && maxRounds > 0 && maxRounds <= policy.maxAttempts, "Bounded loop required");
      let state: unknown = input.initialState; const body = Array.isArray(step.options.body) ? step.options.body as ProgramOperation[] : [step.options.body as ProgramOperation];
      for (let round = 0; round < maxRounds; round++) {
        const child: Context = { ...context, prefix: `${id}/round-${round}/`, steps: body, parent: context, state, depth: context.depth + 1, chain: new Set(context.chain) };
        for (const operation of body) await this.ensure(runId, operation, child);
        const next = await this.evaluate(runId, step.options.next, child), done = await this.evaluate(runId, step.options.until, { ...child, state: next });
        if (done) return { status: "completed", state: next, rounds: round + 1 };
        programAssert(programDigest(next) !== programDigest(state), "Loop stalled"); state = next;
      }
      throw new ProgramError("AF_PROGRAM_EXHAUSTED", "Loop exhausted without acceptance");
    }
    if (step.kind === "repair") return this.repair(runId, id, input, context);
    if (step.kind === "compose") {
      programAssert(Array.isArray(input.candidates) && input.candidates.length > 0, "Candidates required for compose");
      const candidates = input.candidates.map(candidate => this.resolveCandidate(run, candidate)), refs: string[] = [], seen = new Set<string>();
      for (const candidate of candidates) {
        programAssert(candidate.baselineDigest === run.baselineDigest && run.candidates[candidate.candidateId]?.digest === candidate.digest, "Candidate ancestry/baseline mismatch");
        for (const ref of candidate.deltas) if (!seen.has(ref)) { seen.add(ref); refs.push(ref); }
      }
      const artifacts = await Promise.all(refs.map(ref => { programAssert(run.deltas[ref], "Composition delta missing"); return this.store.get<ManagedArtifact>(run.deltas[ref].artifactRef); })), writers = new Map<string, string>();
      for (let index = 0; index < artifacts.length; index++) for (const file of artifacts[index].files) {
        const prior = writers.get(file.path);
        if (prior) programAssert(candidates.some(candidate => candidate.deltas.includes(prior) && candidate.deltas.includes(refs[index]) && candidate.deltas.indexOf(prior) < candidate.deltas.indexOf(refs[index])), `Independent writers conflict at ${file.path}`);
        writers.set(file.path, refs[index]);
      }
      const base = run.baseRef ? await this.store.get<ManagedBase>(run.baseRef) : undefined, digest = base ? (await previewManagedArtifacts(base, artifacts)).digest : programDigest({ candidates: candidates.map(candidate => candidate.digest), refs });
      const parents = candidates.map(candidate => candidate.candidateId), producerAttempts = [...new Set(candidates.flatMap(candidate => candidate.producerAttempts))];
      const candidate: ProgramCandidate = { candidateId: `candidate-${programDigest({ digest, id, parents, refs, producerAttempts }).slice(7, 39)}`, digest, baselineDigest: run.baselineDigest, parents, deltas: refs, producerAttempts };
      await this.store.transact(runId, "compose-candidate", current => { const prior = current!.candidates[candidate.candidateId]; programAssert(!prior || programDigest(prior) === programDigest(candidate), "Compose candidate record cannot be overwritten"); current!.candidates[candidate.candidateId] = candidate; return current!; }); return { candidate };
    }
    if (step.kind === "gate") return this.gate(runId, id, input);
    if (step.kind === "waitEvent") {
      const generation = run.operations[id].generation, correlation = idText(input.correlation), type = idText(input.type);
      const oldWait = run.waits[id];
      if (oldWait?.generation === generation && oldWait.outputRef) return this.store.get(oldWait.outputRef);
      if (!oldWait || oldWait.generation !== generation) {
        const timeoutMs = input.timeoutMs === undefined ? undefined : Number(input.timeoutMs); programAssert(timeoutMs === undefined || Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= policy.deadlineMs, "Wait deadline exceeds policy");
        await this.store.transact(runId, "wait-checkpoint", current => { current!.waits[id] = { generation, ...(timeoutMs ? { deadlineAt: new Date(Date.now() + timeoutMs).toISOString() } : {}) }; return current!; });
      }
      const wait = (await this.state(runId)).waits[id]; programAssert(!wait.deadlineAt || Date.parse(wait.deadlineAt) > Date.now(), "Human wait timed out without approval", "AF_PROGRAM_WAIT_TIMEOUT");
      const signal = (await this.state(runId)).signals.find(signal => signal.target === id && signal.generation === generation && signal.type === type && signal.correlation === correlation && signal.status === "pending" && (!signal.expiresAt || Date.parse(signal.expiresAt) > Date.now()));
      programAssert(signal, "Waiting for a matching authorized event", "AF_PROGRAM_WAITING"); const payload = await this.store.get(signal.payloadRef);
      validateProgramData(payload, registryEntry(run.registry.schemas, input.schema as ProgramRef));
      await this.store.transact(runId, "signal-consumed-and-decision", current => {
        const event = current!.signals.find(event => event.id === signal.id); programAssert(event?.status === "pending" && current!.operations[id].generation === generation && (!event.expiresAt || Date.parse(event.expiresAt) > Date.now()), "Signal already consumed, expired or wait generation changed"); event.status = "consumed";
        current!.waits[id] = { ...current!.waits[id], generation, signalId: signal.id, outputRef: signal.payloadRef };
        current!.operations[id].status = "completed"; current!.operations[id].outputRef = signal.payloadRef; return current!;
      }); return payload;
    }
    if (step.kind === "subworkflow") {
      const childProgram = registryEntry(run.registry.programs ?? {}, input.program as ProgramRef); validateWorkflowProgram(childProgram, run.registry);
      programAssert(programDigest(childProgram.policy) === programDigest(context.program.policy) && programDigest(childProgram.acceptance) === programDigest(context.program.acceptance), "Child cannot replace inherited policy/acceptance");
      validateProgramData(input.input, registryEntry(run.registry.schemas, childProgram.inputSchema));
      const inputRef = await this.store.put(input.input, policy.maxOutputBytes);
      const child: Context = { prefix: `${id}/`, steps: childProgram.steps, program: childProgram, inputRef, parent: context, depth: context.depth + 1, chain: new Set(context.chain) };
      for (const operation of child.steps) await this.ensure(runId, operation, child); const result = await this.evaluate(runId, childProgram.result, child);
      validateProgramData(result, registryEntry(run.registry.schemas, childProgram.outputSchema)); return result;
    }
    programAssert(false, `Unsupported operation ${step.kind}`);
  }
  private async repair(runId: string, id: string, input: Record<string, unknown>, context: Context): Promise<ProgramRepairResult> {
    const run = await this.state(runId), acceptance = registryEntry(run.registry.acceptance, run.program.acceptance);
    const reviewer = registryEntry(run.registry.executors, input.review as ProgramRef), implementer = registryEntry(run.registry.executors, input.implement as ProgramRef);
    programAssert(reviewer.role === "reviewer" && reviewer.effect === "read" && programDigest(reviewer) !== programDigest(implementer), "Repair needs a distinct readonly reviewer executor");
    const maxRounds = Number(input.maxRepairRounds), maxAssessments = Number(input.maxAssessmentAttempts), maxInfrastructure = Number(input.maxInfrastructureAttempts);
    programAssert([maxRounds, maxAssessments, maxInfrastructure].every(limit => Number.isSafeInteger(limit) && limit > 0), "Repair counters must be bounded");
    const origin = run.operations[id], previous = run.repairs[id];
    const checkpoint: ProgramRunV2["repairs"][string] = previous && previous.semanticDigest === origin.semanticDigest && previous.inputDigest === origin.inputDigest ? structuredClone(previous) : {
      semanticDigest: origin.semanticDigest, inputDigest: origin.inputDigest, candidate: this.resolveCandidate(run, input.initialCandidate), rounds: 0, assessments: 0, infrastructure: 0, unchanged: 0, repeated: 0, priorFindings: "", feedback: null, phase: input.entryMode === "implement-first" ? "implement" : "assess",
    };
    // A compatible accepted recipe revalidates its observed assessment in this generation.
    if (checkpoint.phase === "accepted") checkpoint.phase = "assess";
    checkpoint.infrastructure = Math.max(checkpoint.infrastructure, Object.values(run.attempts).filter(attempt => attempt.operationId.startsWith(`${id}/`) && ["infrastructure_failed", "invalid_output"].includes(attempt.outcome)).length);
    if (checkpoint.infrastructure >= maxInfrastructure) checkpoint.phase = "exhausted";
    const save = async (type: string) => { await this.store.transact(runId, type, current => { programAssert(current!.operations[id].generation === origin.generation && current!.operations[id].semanticDigest === origin.semanticDigest, "Fenced recipe checkpoint"); current!.repairs[id] = structuredClone(checkpoint); return current!; }); };
    const progress = asRecord(input.progressPolicy); programAssert(Number(progress.unchangedCandidateRounds) > 0 && Number(progress.repeatedFindingsRounds) > 0, "Progress policy required");
    const scope = input.writeScope as string[], checks = input.checks as string[];
    const activityInputs = { workflowInput: await this.store.get(context.inputRef ?? run.inputRef), ...(context.item === undefined ? {} : { workItem: context.item }), ...(input.input === undefined ? {} : { inputs: input.input }), writeScope: scope, criteria: acceptance.criteria };
    programAssert(Array.isArray(checks) && acceptance.requiredChecks.every(check => checks.includes(check)), "Repair cannot omit required checks");
    const assess = async (): Promise<ProgramAssessment> => {
      const candidate = checkpoint.candidate;
      const review = await this.activity(runId, `${id}/assessment-${checkpoint.assessments}/review`, input.review as ProgramRef, { ...activityInputs, candidateDigest: candidate.digest, feedback: checkpoint.feedback }, candidate, []), report = asRecord(review.data);
      programAssert(["approved", "changes_requested", "inconclusive"].includes(String(report.verdict)) && Array.isArray(report.findings), "Review verdict/findings required");
      const outcomes: { id: string; passed: boolean }[] = [], attemptIds = [review.attemptId];
      for (const check of checks) {
        programAssert(check.includes("@"), "Check must be versioned executor reference"); const split = check.lastIndexOf("@"), reference = { id: check.slice(0, split), version: check.slice(split + 1) }, checker = registryEntry(run.registry.executors, reference);
        programAssert(checker.kind === "command" && checker.effect === "read" && programDigest(checker) !== programDigest(reviewer), "Checks require distinct observed command executors");
        const output = await this.activity(runId, `${id}/assessment-${checkpoint.assessments}/check-${encodeURIComponent(check)}`, reference, { ...activityInputs, candidateDigest: candidate.digest }, candidate, []);
        outcomes.push({ id: check, passed: asRecord(output.data).passed === true }); attemptIds.push(output.attemptId);
      }
      const assessment: ProgramAssessment = { receiptId: `assessment-${randomUUID()}`, operationId: id, generation: origin.generation, semanticDigest: origin.semanticDigest, inputDigest: origin.inputDigest, candidateDigest: candidate.digest, verdict: report.verdict as ProgramAssessment["verdict"], findings: report.findings as unknown[], checks: outcomes, attemptIds };
      await this.store.put(assessment);
      checkpoint.assessment = assessment; checkpoint.phase = "decide";
      await this.store.transact(runId, "assessment-receipt-and-recipe", current => { programAssert(current!.operations[id].generation === origin.generation && current!.operations[id].semanticDigest === origin.semanticDigest && attemptIds.every(attemptId => current!.attempts[attemptId]?.outcome === "completed") && !candidate.producerAttempts.includes(review.attemptId), "Assessment lacks current distinct observed attempts"); current!.assessments[assessment.receiptId!] = assessment; current!.repairs[id] = structuredClone(checkpoint); return current!; });
      return assessment;
    };
    await save("repair-checkpoint");
    for (;;) {
      try {
        await this.checkRunning(runId);
        if (checkpoint.phase === "exhausted" || checkpoint.phase === "stalled") return { status: checkpoint.phase, lastCandidate: checkpoint.candidate, reason: "Persisted repair budget/progress limit reached" };
        if (checkpoint.phase === "implement") {
          if (checkpoint.rounds >= maxRounds) { checkpoint.phase = "exhausted"; await save("repair-exhausted"); continue; }
          const before = checkpoint.candidate.digest, output = await this.activity(runId, `${id}/round-${checkpoint.rounds}/implement`, input.implement as ProgramRef, { ...activityInputs, candidateDigest: before, feedback: checkpoint.feedback }, checkpoint.candidate, scope);
          checkpoint.candidate = output.candidate; checkpoint.rounds++; checkpoint.unchanged = before === output.candidate.digest ? checkpoint.unchanged + 1 : 0;
          checkpoint.phase = "assess"; await save("repair-implementation-checkpoint");
        }
        if (checkpoint.phase === "assess") {
          if (checkpoint.assessments >= maxAssessments) { checkpoint.phase = "exhausted"; await save("repair-exhausted"); continue; }
          checkpoint.assessments++; checkpoint.phase = "assessment-active"; await save("repair-assessment-intent");
        }
        if (checkpoint.phase === "assessment-active") await assess();
        const assessment = checkpoint.assessment!; programAssert(assessment && checkpoint.phase === "decide", "Persisted assessment decision required");
        if (assessment.verdict === "approved" && !assessment.findings.length && assessment.checks.every(check => check.passed)) { checkpoint.phase = "accepted"; await save("repair-accepted"); return { status: "accepted", acceptedCandidate: checkpoint.candidate, assessment }; }
        const findings = programDigest({ verdict: assessment.verdict, findings: assessment.findings, checks: assessment.checks }); checkpoint.repeated = findings === checkpoint.priorFindings ? checkpoint.repeated + 1 : 0; checkpoint.priorFindings = findings;
        checkpoint.feedback = { candidateDigest: assessment.candidateDigest, verdict: assessment.verdict, findings: assessment.findings, checks: assessment.checks };
        checkpoint.phase = checkpoint.unchanged >= Number(progress.unchangedCandidateRounds) || checkpoint.repeated >= Number(progress.repeatedFindingsRounds) ? "stalled" : assessment.verdict === "inconclusive" ? "assess" : "implement";
        await save("repair-decision");
      } catch (error) {
        const current = await this.state(runId);
        if (current.status !== "executing" || current.operations[id].generation !== origin.generation) throw error;
        if (Object.values(current.attempts).some(attempt => attempt.operationId.startsWith(`${id}/`) && attempt.outcome === "uncertain")) return { status: "uncertain", lastCandidate: checkpoint.candidate, reason: (error as Error).message };
        checkpoint.infrastructure++; if (checkpoint.infrastructure >= maxInfrastructure) checkpoint.phase = "exhausted";
        await save("repair-infrastructure-checkpoint");
      }
    }
  }
  private async gate(runId: string, id: string, input: Record<string, unknown>): Promise<unknown> {
    const run = await this.state(runId), candidate = this.resolveCandidate(run, input.candidate), acceptance = registryEntry(run.registry.acceptance, run.program.acceptance), policy = registryEntry(run.registry.policies, run.program.policy);
    programAssert(run.candidates[candidate.candidateId]?.digest === candidate.digest, "Unregistered candidate");
    programAssert(input.obligations === undefined || programDigest(input.obligations) === programDigest(acceptance), "Gate cannot replace owner acceptance obligations");
    programAssert(!Object.values(run.attempts).some(attempt => attempt.outcome === "uncertain"), "Uncertain effects block gate");
    const assessment = Object.values(run.assessments).find(assessment => {
      const origin = assessment.operationId ? run.operations[assessment.operationId] : undefined;
      return origin && origin.status === "completed" && origin.generation === assessment.generation && origin.semanticDigest === assessment.semanticDigest && origin.inputDigest === assessment.inputDigest && assessment.candidateDigest === candidate.digest && assessment.verdict === "approved" && !assessment.findings.length && assessment.attemptIds.every(attemptId => run.attempts[attemptId]?.outcome === "completed") && acceptance.requiredChecks.every(check => assessment.checks.some(outcome => outcome.id === check && outcome.passed));
    });
    programAssert(!acceptance.requireReview || assessment, "Applicable distinct review/checks missing");
    programAssert(assessment || acceptance.requiredChecks.length === 0, "Required checks missing");
    if (run.program.population) {
      const coverage = asRecord(input.coverage), registered = run.coverageReceipts[String(coverage.receiptId)];
      programAssert(registered && programDigest(Object.fromEntries(Object.entries(coverage).filter(([key]) => key !== "receiptId"))) === programDigest(registered) && registered.populationDigest === programDigest(registryEntry(run.registry.populations, run.program.population)), "Owner coverage receipt missing/mismatched");
      programAssert(Object.entries(run.collections).some(([operationId, collection]) => collection.coverageReceiptId === coverage.receiptId && collection.obligationsSatisfied && collection.seal === run.seals[operationId] && run.operations[operationId]?.status === "completed" && run.operations[operationId]?.generation === collection.generation && programDigest(collection.ids) === programDigest(registered.ids) && collection.acceptedCandidateIds.every(candidateId => { const accepted = run.candidates[candidateId]; return accepted && accepted.deltas.every(delta => candidate.deltas.includes(delta)) && accepted.producerAttempts.every(attempt => candidate.producerAttempts.includes(attempt)); }) && collection.acceptedAssessmentIds.every(receiptId => {
        const receipt = run.assessments[receiptId], origin = receipt?.operationId ? run.operations[receipt.operationId] : undefined;
        return origin?.status === "completed" && origin.generation === receipt.generation && receipt.verdict === "approved" && !receipt.findings.length && receipt.attemptIds.every(attemptId => run.attempts[attemptId]?.outcome === "completed") && acceptance.requiredChecks.every(check => receipt.checks.some(outcome => outcome.id === check && outcome.passed));
      })), "Population gate requires closed item acceptance, not discovery coverage alone");
    }
    const receipt = { gateId: id, candidateDigest: candidate.digest, semanticVersion: run.semanticVersion, programDigest: run.programDigest,
      acceptanceDigest: programDigest(acceptance), policyDigest: programDigest(policy), populationDigest: run.program.population ? programDigest(registryEntry(run.registry.populations, run.program.population)) : programDigest(null), seals: run.seals, criteria: acceptance.criteria, assessment: assessment ?? null, coverage: input.coverage ?? null };
    const gateRef = await this.store.put(receipt);
    await this.store.transact(runId, "gate-receipt", current => { programAssert(current!.semanticVersion === run.semanticVersion && current!.programDigest === run.programDigest, "Gate inputs changed"); current!.gateRef = gateRef; current!.acceptedCandidate = candidate; return current!; }); return { passed: true, gateRef, candidate };
  }
  private async apply(runId: string, request: Record<string, unknown>): Promise<unknown> {
    const run = await this.state(runId);
    if (run.intent && run.intent.requestId === request.requestId) { programAssert(run.intent.requestDigest === programDigest(request), "Apply requestId body changed", "AF_PROGRAM_CONFLICT"); return run; }
    programAssert(!this.closed && run.status === "acceptance-ready" && run.baseRef && run.gateRef && request.authorization, "Applicable gate and existing authorization required");
    const gate = await this.store.get<Record<string, unknown>>(run.gateRef), candidate = Object.values(run.candidates).find(candidate => candidate.digest === gate.candidateDigest); programAssert(candidate, "Gate candidate absent");
    const base = await this.store.get<ManagedBase>(run.baseRef), artifacts = await this.artifacts(runId, candidate), expected = await previewManagedArtifacts(base, artifacts);
    let won = false;
    const state = await this.store.transact(runId, "apply-intent", current => {
      programAssert(!Object.values(current!.attempts).some(attempt => attempt.outcome === "running" || attempt.outcome === "uncertain") && !Object.values(current!.operations).some(operation => operation.status !== "completed" && operation.status !== "skipped"), "Unsettled or rejected work blocks application");
      programAssert(current?.status === "acceptance-ready" && current.gateRef === run.gateRef && current.semanticVersion === gate.semanticVersion && current.programDigest === gate.programDigest && programDigest(current.seals) === programDigest(gate.seals), "Apply gate/tuple changed");
      current.intent = { id: `apply-${randomUUID()}`, requestId: idText(request.requestId), requestDigest: programDigest(request), candidateDigest: candidate.digest, gateRef: run.gateRef!, semanticVersion: current.semanticVersion, programDigest: current.programDigest,
        acceptanceDigest: String(gate.acceptanceDigest), policyDigest: String(gate.policyDigest), populationDigest: String(gate.populationDigest), sealRefs: Object.values(current.seals), authorization: String(request.authorization), expectedDigest: expected.digest, changedFiles: expected.changedFiles };
      current.status = "applying"; won = true; return current;
    }, { requestId: idText(request.requestId), fingerprint: programDigest(request), expectedVersion: Number(request.expectedVersion) });
    if (!won) return state;
    try {
      const receipt = await publishManagedArtifacts(base, artifacts, { beforeWrite: async () => { const current = await this.state(runId); programAssert(current.status === "applying" && current.intent?.id === state.intent?.id, "Application canceled/revoked; reconcile before continuing"); } }), receiptRef = await this.store.put({ ...receipt, intent: state.intent });
      return await this.store.transact(runId, "applied", current => { programAssert(current && current.status === "applying" && current.intent && current.intent.id === state.intent?.id, "Apply interrupted; reconcile actual files"); programAssert(receipt.digest === current.intent.expectedDigest, "Applied digest mismatch"); current.status = "applied"; current.receiptRef = receiptRef; return current; });
    } catch (error) {
      return this.store.transact(runId, "apply-uncertain", current => { if (current!.status !== "applied" && current!.intent?.id === state.intent?.id) { current!.status = "apply-uncertain"; current!.reason = (error as Error).message.slice(0, 1000); } return current!; });
    }
  }
  private async reconcileApply(runId: string, request: Record<string, unknown>): Promise<unknown> {
    const run = await this.state(runId); programAssert(run.status === "apply-uncertain" && run.intent && run.baseRef, "Uncertain apply required");
    const base = await this.store.get<ManagedBase>(run.baseRef), candidate = Object.values(run.candidates).find(candidate => candidate.digest === run.intent!.candidateDigest); programAssert(candidate, "Intent candidate absent");
    if (request.publication === "retry") {
      programAssert(request.authorization && await confirmManagedBaseline(base), "Retry requires authorization and observed complete original baseline");
      return this.store.transact(runId, "apply-retry-authorized", current => { programAssert(current!.status === "apply-uncertain" && current!.intent?.id === run.intent?.id, "Intent changed"); delete current!.intent; delete current!.gateRef; delete current!.acceptedCandidate; delete current!.resultRef; current!.semanticVersion++; current!.status = "paused"; current!.reason = "Original baseline observed; explicit resume/revalidation required"; return current!; }, { requestId: idText(request.requestId), fingerprint: programDigest(request), expectedVersion: Number(request.expectedVersion) });
    }
    const observed = await confirmManagedPublication(base, await this.artifacts(runId, candidate));
    programAssert(observed, "Publication does not match frozen intent; preserve partial files");
    const receiptRef = await this.store.put({ observed, intent: run.intent });
    return this.store.transact(runId, "apply-reconciled", current => { programAssert(current && current.intent?.id === run.intent?.id, "Intent changed"); current.status = "applied"; current.receiptRef = receiptRef; return current; }, { requestId: idText(request.requestId), fingerprint: programDigest(request), expectedVersion: Number(request.expectedVersion) });
  }
}
