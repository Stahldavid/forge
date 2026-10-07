import { mkdir, open, readFile, rename, unlink, realpath, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { assertAttachedSafePath } from "./attached-snapshot.ts";
import { ProgramFileLease } from "./program-lock.ts";
import { stableStringify } from "./canonical.ts";
import { programAssert, programDigest, validateWorkflowProgram, type ProgramRunV2 } from "./program-contract.ts";

interface ProgramReceipt { requestId: string; fingerprint: string; version: number }
interface ProgramTransition { runId: string; version: number; type: string; at: string; stateDigest: string; stateRef: string; parentRef?: string }
interface ProgramRecord { format: 3; runId: string; stateRef: string; journalRef: string; version: number; receipts: ProgramReceipt[] }
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const sharingViolation = (error: unknown) => ["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "");
async function retrySharing<T>(action: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 1000;
  for (;;) { try { return await action(); } catch (error) { if (!sharingViolation(error) || Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 20)); } }
}
/** One authoritative atomic record per run; artifacts commit before referring transitions. */
export class ProgramRunStore {
  readonly metrics = { transactions: 0, transactionMs: 0, bytesWritten: 0, snapshotBytes: 0, journalBytes: 0, envelopeBytes: 0, artifactBytes: 0, artifactReads: 0 };
  private tails = new Map<string, Promise<unknown>>();
  private definitions = new Set<string>();
  private validate(state: ProgramRunV2): void {
    const key = `${programDigest(state.program)}:${programDigest(state.registry)}`;
    if (!this.definitions.has(key)) { validateWorkflowProgram(state.program, state.registry); this.definitions.add(key); }
  }
  private constructor(readonly root: string, readonly directory: string) {}
  static async open(root: string): Promise<ProgramRunStore> {
    root = await realpath(root); const directory = join(root, ".forge/local/agent-fabric/program-runs-v3");
    await assertAttachedSafePath(root, directory); await mkdir(join(directory, "artifacts"), { recursive: true });
    await assertAttachedSafePath(root, directory); return new ProgramRunStore(root, directory);
  }
  private path(id: string): string { programAssert(typeof id === "string" && id.length > 0 && id.length <= 256, "Invalid run ID"); return join(this.directory, `${programDigest(id).slice(7)}.json`); }
  async put(value: unknown, maxBytes = 4 * 1024 * 1024, category: "snapshotBytes" | "journalBytes" | "artifactBytes" = "artifactBytes"): Promise<string> {
    const bytes = stableStringify(value), digest = programDigest(value); programAssert(Buffer.byteLength(bytes) <= maxBytes, "Artifact too large");
    const path = join(this.directory, "artifacts", `${digest.slice(7)}.json`); await assertAttachedSafePath(this.root, path);
    const temp = `${path}.${randomUUID()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); this.metrics.bytesWritten += Buffer.byteLength(bytes); this.metrics[category] += Buffer.byteLength(bytes); } finally { await handle.close(); }
    try {
      try { programAssert(await readFile(path, "utf8") === bytes, "Immutable artifact corrupted"); }
      catch (error) { if (!absent(error)) throw error; await retrySharing(() => rename(temp, path)); }
    } finally { await unlink(temp).catch(() => {}); }
    return digest;
  }
  async get<T = unknown>(digest: string): Promise<T> {
    this.metrics.artifactReads++;
    programAssert(/^sha256:[a-f0-9]{64}$/.test(digest), "Invalid artifact reference");
    const path = join(this.directory, "artifacts", `${digest.slice(7)}.json`); await assertAttachedSafePath(this.root, path);
    const bytes = await readFile(path, "utf8"); programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, "Artifact exceeds physical limit");
    const value = JSON.parse(bytes); programAssert(programDigest(value) === digest, "Artifact integrity failed"); return value as T;
  }
  async putBinary(bytes: Uint8Array, maxBytes = 8 * 1024 * 1024): Promise<string> {
    programAssert(bytes.byteLength <= maxBytes, "Binary artifact exceeds byte budget");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`, path = join(this.directory, "artifacts", `${digest.slice(7)}.blob`);
    await assertAttachedSafePath(this.root, path);
    const temp = `${path}.${randomUUID()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); this.metrics.bytesWritten += bytes.byteLength; this.metrics.artifactBytes += bytes.byteLength; } finally { await handle.close(); }
    try { try { programAssert((await readFile(path)).equals(Buffer.from(bytes)), "Immutable binary corrupted"); } catch (error) { if (!absent(error)) throw error; await retrySharing(() => rename(temp, path)); } }
    finally { await unlink(temp).catch(() => {}); } return digest;
  }
  async getBinary(digest: string, maxBytes = 8 * 1024 * 1024): Promise<Buffer> {
    programAssert(/^sha256:[a-f0-9]{64}$/.test(digest), "Invalid binary reference");
    const path = join(this.directory, "artifacts", `${digest.slice(7)}.blob`); await assertAttachedSafePath(this.root, path);
    programAssert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && (await stat(path)).size <= maxBytes, "Binary exceeds physical byte budget");
    const bytes = await readFile(path); programAssert(bytes.length <= maxBytes && `sha256:${createHash("sha256").update(bytes).digest("hex")}` === digest, "Binary integrity/byte limit failed"); return bytes;
  }
  private async record(id: string): Promise<ProgramRecord | undefined> {
    const path = this.path(id); await assertAttachedSafePath(this.root, path);
    let bytes: string; try { bytes = await retrySharing(() => readFile(path, "utf8")); } catch (error) { if (absent(error)) return; throw error; }
    programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, "Program record exceeds limit");
    const envelope = JSON.parse(bytes) as { record: ProgramRecord; digest: string };
    programAssert(programDigest(envelope.record) === envelope.digest, "Program record integrity failed");
    const record = envelope.record;
    programAssert(record.format === 3 && record.runId === id && record.version > 0, "Unsupported/corrupt program record; start a new run");
    const state = await this.get<ProgramRunV2>(record.stateRef), checkpoint = await this.get<ProgramTransition>(record.journalRef);
    programAssert(state.schemaVersion === 2 && state.runId === id && state.version === record.version, "Invalid persisted run identity");
    this.validate(state);
    programAssert(programDigest(state.program) === state.programDigest && programDigest(state.registry) === state.registryDigest, "Pinned program/registry corrupted");
    programAssert(checkpoint.runId === id && checkpoint.stateDigest === record.stateRef && checkpoint.stateRef === record.stateRef && checkpoint.version === state.version, "Checkpoint/journal mismatch");
    return record;
  }
  async read(id: string): Promise<ProgramRunV2 | undefined> { const record = await this.record(id); return record ? this.get<ProgramRunV2>(record.stateRef) : undefined; }
  async history(id: string): Promise<ProgramTransition[]> {
    const record = await this.record(id); if (!record) return [];
    const history: ProgramTransition[] = []; let ref: string | undefined = record.journalRef, version = record.version;
    while (ref) {
      const node: ProgramTransition = await this.get<ProgramTransition>(ref);
      programAssert(node.runId === id && node.version === version-- && node.stateDigest === node.stateRef && history.length < 100000, "Journal chain mismatch");
      const state = await this.get<ProgramRunV2>(node.stateRef);
      programAssert(state.runId === id && state.version === node.version, "Historical snapshot identity mismatch");
      history.push(node); ref = node.parentRef;
    }
    programAssert(version === 0, "Truncated program journal"); return history.reverse();
  }
  async list(): Promise<string[]> {
    const ids: string[] = [];
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(this.directory, name); await assertAttachedSafePath(this.root, path);
      const envelope = JSON.parse(await readFile(path, "utf8"));
      programAssert(envelope?.record?.runId && this.path(envelope.record.runId) === path, "Run filename/identity mismatch");
      await this.record(envelope.record.runId); ids.push(envelope.record.runId);
    }
    return ids;
  }
  async transact(id: string, type: string, mutate: (state?: ProgramRunV2) => ProgramRunV2,
    options: { requestId?: string; fingerprint?: string; expectedVersion?: number } = {}): Promise<ProgramRunV2> {
    const task = (this.tails.get(id) ?? Promise.resolve()).catch(() => {}).then(() => this.transaction(id, type, mutate, options));
    this.tails.set(id, task);
    try { return await task; } finally { if (this.tails.get(id) === task) this.tails.delete(id); }
  }
  private async transaction(id: string, type: string, mutate: (state?: ProgramRunV2) => ProgramRunV2,
    options: { requestId?: string; fingerprint?: string; expectedVersion?: number }): Promise<ProgramRunV2> {
    const transactionStarted = performance.now();
    const path = this.path(id), lock = `${path}.lock`;
    await assertAttachedSafePath(this.root, lock); await assertAttachedSafePath(this.root, `${lock}.reclaim`);
    const lease = await ProgramFileLease.acquire(lock, { waitMs: 10000 });
    try {
      const old = await this.record(id), receipt = old?.receipts.find(entry => entry.requestId === options.requestId);
      if (receipt) { programAssert(receipt.fingerprint === options.fingerprint, "requestId body changed", "AF_PROGRAM_CONFLICT"); return this.get<ProgramRunV2>(old!.stateRef); }
      programAssert(options.expectedVersion === undefined || options.expectedVersion === (old?.version ?? 0), "Version conflict", "AF_PROGRAM_CONFLICT");
      if (options.requestId) programAssert(typeof options.fingerprint === "string", "Request fingerprint required");
      const oldState = old ? await this.get<ProgramRunV2>(old.stateRef) : undefined;
      if (type === "attempt-dispatch-intent") programAssert(!old || old.version < 90000 && Buffer.byteLength(stableStringify(oldState)) < 24 * 1024 * 1024, "Journal dispatch reserve exhausted; recovery remains available");
      const state = mutate(oldState);
      if (old && !options.requestId && programDigest(state) === old.stateRef) return structuredClone(state);
      state.version = (old?.version ?? 0) + 1;
      this.validate(state);
      const stateRef = await this.put(state, 32 * 1024 * 1024, "snapshotBytes");
      const journalRef = await this.put({ runId: id, version: state.version, type, at: new Date().toISOString(), stateDigest: stateRef, stateRef, ...(old ? { parentRef: old.journalRef } : {}) }, 4096, "journalBytes");
      const record: ProgramRecord = { format: 3, runId: id, version: state.version, stateRef, journalRef,
        receipts: [...(old?.receipts ?? []), ...(options.requestId ? [{ requestId: options.requestId, fingerprint: options.fingerprint!, version: state.version }] : [])] };
      const bytes = stableStringify({ record, digest: programDigest(record) }); programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024 && record.receipts.length <= 10000 && record.version <= 100000, "Program journal limit exceeded");
      const token = lease.token;
      const temp = `${path}.${token}.tmp`, handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); this.metrics.bytesWritten += Buffer.byteLength(bytes); this.metrics.envelopeBytes += Buffer.byteLength(bytes); } finally { await handle.close(); }
      this.metrics.transactions++; this.metrics.transactionMs += performance.now() - transactionStarted;
      try { await assertAttachedSafePath(this.root, path); await retrySharing(() => rename(temp, path)); } finally { await unlink(temp).catch(() => {}); }
      return structuredClone(state);
    } finally { await retrySharing(() => lease.close()); }
  }
}
