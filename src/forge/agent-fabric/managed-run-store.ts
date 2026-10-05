import { mkdir, open, readFile, rename, unlink, link, lstat, realpath, readdir } from "node:fs/promises";
import { readFileSync, unlinkSync, lstatSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { managedFail, managedId, managedDigest, validateManagedSpec, type ManagedRunState } from "./managed-run-contract.ts";
import { validateWorkflowState } from "./workflow-engine.ts";
import { assertAttachedSafePath } from "./attached-snapshot.ts";
import { stableStringify } from "./canonical.ts";

interface Ack { runId: string; version: number; status: ManagedRunState["status"] }
interface Receipt { requestId: string; fingerprint: string; ack: Ack }
interface RecordFile { state: ManagedRunState; receipts: Receipt[] }
export interface ManagedTransactionOptions { requestId?: string; fingerprint?: string; expectedVersion?: number }
const MAX_RECORD = 32 * 1024 * 1024;
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
async function readLock(path: string): Promise<string> {
  const deadline = Date.now() + 1000;
  for (;;) {
    try { return await readFile(path, "utf8"); }
    catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
const statuses = ["preparing", "running", "paused", "blocked", "canceling", "canceled", "publishing", "completed", "failed"];
/** Windows readers/AV may briefly hold the destination; never unlink its atomic predecessor. */
async function replaceRecord(temp: string, destination: string): Promise<void> {
  const deadline = Date.now() + 1000;
  while (true) {
    try { await rename(temp, destination); return; }
    catch (error) {
      if (!["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "") || Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }
function assert(value: unknown, message: string): asserts value { if (!value) managedFail("AF_RUN_STORE", message); }
function validateState(state: ManagedRunState, root: string, runId: string) {
  assert(state && Object.keys(state).every(key => ["schemaVersion", "runId", "repositoryRoot", "ownerPid", "version", "spec", "workflow", "base", "status", "steps", "events", "cursor", "instructions", "createdAt", "updatedAt", "published", "publicationIntent", "error"].includes(key)), "Invalid run fields");
  assert(state.schemaVersion === 1 && state.runId === runId && state.repositoryRoot === root, "Invalid run identity");
  assert(Number.isSafeInteger(state.version) && state.version > 0 && Number.isSafeInteger(state.ownerPid) && state.ownerPid > 0 && statuses.includes(state.status), "Invalid run version, owner or status");
  validateManagedSpec(state.spec); validateWorkflowState(state.workflow);
  assert(state.workflow.workflowId === state.spec.workflow.workflowId, "Workflow identity mismatch");
  assert(Array.isArray(state.steps) && state.steps.length <= 100 && new Set(state.steps.map(step => step.attemptId)).size === state.steps.length, "Invalid steps");
  for (const step of state.steps) {
    managedId(step.attemptId, "attemptId"); managedId(step.nodeId, "nodeId");
    assert(["running", "succeeded", "failed", "uncertain"].includes(step.status) && state.workflow.runs.some(run => run.attemptId === step.attemptId && run.nodeId === step.nodeId && run.status === step.status), "Step attempt mismatch");
    assert(step.directory === undefined || (isAbsolute(step.directory) && resolve(step.directory) === step.directory), "Invalid workspace directory");
    if (step.repositoryContext !== undefined) {
      const context = step.repositoryContext;
      assert(context && Object.keys(context).every(key => ["provider", "phase", "status", "sourceRoot", "cloneRoot", "snapshotId", "diagnostics"].includes(key)), "Invalid repository context fields");
      assert(context.provider === "repository" && context.phase === "prepared-input" && ["ready", "unavailable"].includes(context.status) && context.sourceRoot === root && context.cloneRoot === step.directory, "Repository context belongs to another checkout");
      assert(Array.isArray(context.diagnostics) && context.diagnostics.length <= 20 && context.diagnostics.every(message => typeof message === "string" && message.length <= 512), "Invalid repository context diagnostics");
      assert(context.snapshotId === undefined || (typeof context.snapshotId === "string" && context.snapshotId.length <= 256 && context.snapshotId.length > 0), "Invalid repository context snapshot");
      assert(context.status !== "ready" || context.snapshotId !== undefined, "Ready repository context requires a snapshot");
    }
  }
  assert(Number.isSafeInteger(state.cursor) && state.cursor >= 0 && Array.isArray(state.events) && state.events.length <= 10000, "Invalid event history");
  let cursor = 0; for (const event of state.events) { assert(Number.isSafeInteger(event.cursor) && event.cursor > cursor && event.cursor <= state.cursor && typeof event.summary === "string" && typeof event.type === "string" && Number.isFinite(Date.parse(event.at)), "Invalid event"); cursor = event.cursor; }
  assert(Array.isArray(state.instructions) && state.instructions.length <= 1000 && state.instructions.every(item => typeof item === "string" && item.length <= 12000), "Invalid instructions");
  assert(Number.isFinite(Date.parse(state.createdAt)) && Number.isFinite(Date.parse(state.updatedAt)), "Invalid timestamps");
  if (state.base) assert(state.base.root === root && state.base.runId === runId && isAbsolute(state.base.baselineDirectory) && /^sha256:[a-f0-9]{64}$/.test(state.base.digest) && /^[a-f0-9]{40,64}$/.test(state.base.head) && stableStringify(state.base.scope) === stableStringify([...state.spec.scope].sort()), "Invalid managed base");
}
function reclaimDeadGuard(path: string) {
  try {
    if (!lstatSync(path).isFile()) managedFail("AF_RUN_LOCK", "Unsupported reclaim guard");
    const raw = readFileSync(path, "utf8"), owner = JSON.parse(raw);
    if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && !alive(owner.pid) && readFileSync(path, "utf8") === raw) unlinkSync(path);
  } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error; }
}
/** Atomic state + compact receipts. Locks serialize independent service processes. */
export class ManagedRunStore {
  private constructor(readonly root: string, readonly directory: string) {}
  static async open(root: string): Promise<ManagedRunStore> {
    root = await realpath(root); const directory = join(root, ".forge", "local", "agent-fabric", "managed-runs");
    await assertAttachedSafePath(root, directory); await mkdir(directory, { recursive: true }); await assertAttachedSafePath(root, directory);
    return new ManagedRunStore(root, directory);
  }
  private path(runId: string) { managedId(runId, "runId"); return join(this.directory, `${managedDigest(runId).slice(7)}.json`); }
  async read(runId: string): Promise<ManagedRunState | undefined> { const record = await this.load(runId); return record ? structuredClone(record.state) : undefined; }
  async list(): Promise<string[]> {
    await assertAttachedSafePath(this.root, this.directory); const ids: string[] = [];
    for (const name of (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      const path = join(this.directory, name); await assertAttachedSafePath(this.root, path);
      assert((await lstat(path)).size <= MAX_RECORD, "Run record exceeds size limit");
      const envelope = JSON.parse(await readFile(path, "utf8")); const runId = managedId(envelope?.record?.state?.runId, "stored runId");
      assert(this.path(runId) === path, "Run filename mismatch"); await this.load(runId); ids.push(runId);
    }
    return ids.sort();
  }
  private async load(runId: string): Promise<RecordFile | undefined> {
    const path = this.path(runId); await assertAttachedSafePath(this.root, path);
    try {
      assert((await lstat(path)).isFile() && (await lstat(path)).size <= MAX_RECORD, "Unsupported or excessive run record");
      const envelope = JSON.parse(await readFile(path, "utf8"));
      assert(envelope && Object.keys(envelope).length === 2 && envelope.record && envelope.digest === managedDigest(stableStringify(envelope.record)), "Run integrity check failed");
      const record = envelope.record as RecordFile; assert(Object.keys(record).every(key => ["state", "receipts"].includes(key)) && Array.isArray(record.receipts) && record.receipts.length <= 10000, "Invalid run record");
      validateState(record.state, this.root, runId); const ids = new Set<string>();
      for (const receipt of record.receipts) {
        managedId(receipt.requestId, "requestId"); assert(!ids.has(receipt.requestId) && /^(?:sha256:)?[a-f0-9]{64}$/.test(receipt.fingerprint), "Invalid request receipt"); ids.add(receipt.requestId);
        assert(receipt.ack.runId === runId && Number.isSafeInteger(receipt.ack.version) && receipt.ack.version > 0 && receipt.ack.version <= record.state.version && statuses.includes(receipt.ack.status), "Invalid acknowledgment");
      }
      return record;
    } catch (error) { if (missing(error)) return undefined; if (error instanceof SyntaxError) managedFail("AF_RUN_STORE", "Malformed run JSON"); throw error; }
  }
  private async lock(runId: string): Promise<() => Promise<void>> {
    const lock = `${this.path(runId)}.lock`, token = randomUUID(), candidate = `${lock}.${token}.candidate`, claim = `${lock}.reclaim`;
    const ownerBytes = JSON.stringify({ pid: process.pid, token }), deadline = Date.now() + 10000;
    await assertAttachedSafePath(this.root, candidate); const handle = await open(candidate, "wx", 0o600);
    try { await handle.writeFile(ownerBytes); await handle.sync(); } finally { await handle.close(); }
    try {
      while (true) {
        await assertAttachedSafePath(this.root, lock);
        try { await link(candidate, lock); return async () => { await assertAttachedSafePath(this.root, lock); if (await readLock(lock) !== ownerBytes) managedFail("AF_RUN_LOCK", "Lock ownership changed"); await unlink(lock); }; }
        catch (error) { if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
        try {
          assert((await lstat(lock)).isFile(), "Unsupported lock"); const raw = await readLock(lock), previous = JSON.parse(raw);
          if (Number.isSafeInteger(previous.pid) && previous.pid > 0 && !alive(previous.pid)) {
            await assertAttachedSafePath(this.root, claim); reclaimDeadGuard(claim); let claimed = false;
            try { await link(candidate, claim); claimed = true; if (readFileSync(lock, "utf8") === raw) unlinkSync(lock); }
            catch (error) { if (!missing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
            finally { if (claimed) await unlink(claim).catch(() => {}); }
          }
        } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error; }
        if (Date.now() >= deadline) managedFail("AF_RUN_LOCK_BUSY", "Run is locked by another process");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await unlink(candidate).catch(() => {}); }
  }
  async transact(runId: string, options: ManagedTransactionOptions, apply: (current?: ManagedRunState) => ManagedRunState): Promise<{ state: ManagedRunState; ack: Ack; replayed: boolean }> {
    managedId(runId, "runId"); assert(options && Object.keys(options).every(key => ["requestId", "fingerprint", "expectedVersion"].includes(key)), "Invalid transaction options");
    if (options.requestId !== undefined) { managedId(options.requestId, "requestId"); assert(typeof options.fingerprint === "string" && /^(?:sha256:)?[a-f0-9]{64}$/.test(options.fingerprint), "Request fingerprint required"); }
    else assert(options.fingerprint === undefined, "Fingerprint without requestId");
    assert(options.expectedVersion === undefined || (Number.isSafeInteger(options.expectedVersion) && options.expectedVersion >= 0), "Invalid expectedVersion");
    const release = await this.lock(runId);
    try {
      const old = await this.load(runId), receipt = old?.receipts.find(item => item.requestId === options.requestId);
      if (receipt) { if (receipt.fingerprint !== options.fingerprint) managedFail("AF_RUN_REQUEST_CONFLICT", "requestId already used with different input"); return { state: structuredClone(old!.state), ack: structuredClone(receipt.ack), replayed: true }; }
      if (options.expectedVersion !== undefined && options.expectedVersion !== (old?.state.version ?? 0)) managedFail("AF_RUN_VERSION_CONFLICT", `Expected version ${old?.state.version ?? 0}`);
      const state = structuredClone(apply(old ? structuredClone(old.state) : undefined));
      state.version = (old?.state.version ?? 0) + 1; state.updatedAt = new Date().toISOString(); validateState(state, this.root, runId);
      const ack: Ack = { runId, version: state.version, status: state.status };
      const record: RecordFile = { state, receipts: [...(old?.receipts ?? []), ...(options.requestId ? [{ requestId: options.requestId, fingerprint: options.fingerprint!, ack }] : [])] };
      const data = stableStringify({ record, digest: managedDigest(stableStringify(record)) }); assert(Buffer.byteLength(data) <= MAX_RECORD && record.receipts.length <= 10000, "Run record limit exceeded");
      const temp = `${this.path(runId)}.${randomUUID()}.tmp`; await assertAttachedSafePath(this.root, temp); const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      try { await assertAttachedSafePath(this.root, this.path(runId)); await replaceRecord(temp, this.path(runId)); } finally { await unlink(temp).catch(() => {}); }
      return { state: structuredClone(state), ack: structuredClone(ack), replayed: false };
    } finally { await release(); }
  }
}
