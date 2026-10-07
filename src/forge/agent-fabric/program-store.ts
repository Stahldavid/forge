import { mkdir, open, readFile, rename, unlink, realpath, readdir, link } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { assertAttachedSafePath } from "./attached-snapshot.ts";
import { stableStringify } from "./canonical.ts";
import { programAssert, programDigest, validateWorkflowProgram, type ProgramRunV2 } from "./program-contract.ts";

interface ProgramReceipt { requestId: string; fingerprint: string; version: number }
interface ProgramRecord { state: ProgramRunV2; receipts: ProgramReceipt[]; transitions: { version: number; type: string; at: string; stateDigest: string; stateRef: string }[] }
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const sharingViolation = (error: unknown) => ["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "");
async function retrySharing<T>(action: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + 1000;
  for (;;) { try { return await action(); } catch (error) { if (!sharingViolation(error) || Date.now() >= deadline) throw error; await new Promise(resolve => setTimeout(resolve, 20)); } }
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }

/** One authoritative atomic record per run; artifacts commit before referring transitions. */
export class ProgramRunStore {
  private constructor(readonly root: string, readonly directory: string) {}
  static async open(root: string): Promise<ProgramRunStore> {
    root = await realpath(root); const directory = join(root, ".forge/local/agent-fabric/program-runs");
    await assertAttachedSafePath(root, directory); await mkdir(join(directory, "artifacts"), { recursive: true });
    await assertAttachedSafePath(root, directory); return new ProgramRunStore(root, directory);
  }
  private path(id: string): string { programAssert(typeof id === "string" && id.length > 0 && id.length <= 256, "Invalid run ID"); return join(this.directory, `${programDigest(id).slice(7)}.json`); }
  async put(value: unknown, maxBytes = 4 * 1024 * 1024): Promise<string> {
    const bytes = stableStringify(value), digest = programDigest(value); programAssert(Buffer.byteLength(bytes) <= maxBytes, "Artifact too large");
    const path = join(this.directory, "artifacts", `${digest.slice(7)}.json`); await assertAttachedSafePath(this.root, path);
    const temp = `${path}.${randomUUID()}.tmp`, handle = await open(temp, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      try { programAssert(await readFile(path, "utf8") === bytes, "Immutable artifact corrupted"); }
      catch (error) { if (!absent(error)) throw error; await retrySharing(() => rename(temp, path)); }
    } finally { await unlink(temp).catch(() => {}); }
    return digest;
  }
  async get<T = unknown>(digest: string): Promise<T> {
    programAssert(/^sha256:[a-f0-9]{64}$/.test(digest), "Invalid artifact reference");
    const path = join(this.directory, "artifacts", `${digest.slice(7)}.json`); await assertAttachedSafePath(this.root, path);
    const bytes = await readFile(path, "utf8"); programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, "Artifact exceeds physical limit");
    const value = JSON.parse(bytes); programAssert(programDigest(value) === digest, "Artifact integrity failed"); return value as T;
  }
  private async record(id: string): Promise<ProgramRecord | undefined> {
    const path = this.path(id); await assertAttachedSafePath(this.root, path);
    let bytes: string; try { bytes = await retrySharing(() => readFile(path, "utf8")); } catch (error) { if (absent(error)) return; throw error; }
    programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024, "Program record exceeds limit");
    const envelope = JSON.parse(bytes) as { record: ProgramRecord; digest: string };
    programAssert(programDigest(envelope.record) === envelope.digest, "Program record integrity failed");
    const state = envelope.record.state;
    programAssert(state.schemaVersion === 2 && state.runId === id && state.version > 0, "Invalid persisted run identity");
    validateWorkflowProgram(state.program, state.registry);
    programAssert(programDigest(state.program) === state.programDigest && programDigest(state.registry) === state.registryDigest, "Pinned program/registry corrupted");
    programAssert(envelope.record.transitions.at(-1)?.stateDigest === programDigest(state) && envelope.record.transitions.at(-1)?.version === state.version, "Checkpoint/journal mismatch");
    return envelope.record;
  }
  async read(id: string): Promise<ProgramRunV2 | undefined> { return (await this.record(id))?.state; }
  async history(id: string): Promise<ProgramRecord["transitions"]> { return (await this.record(id))?.transitions ?? []; }
  async list(): Promise<string[]> {
    const ids: string[] = [];
    for (const name of await readdir(this.directory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const path = join(this.directory, name); await assertAttachedSafePath(this.root, path);
      const envelope = JSON.parse(await readFile(path, "utf8"));
      programAssert(envelope?.record?.state?.runId && this.path(envelope.record.state.runId) === path, "Run filename/identity mismatch");
      await this.record(envelope.record.state.runId); ids.push(envelope.record.state.runId);
    }
    return ids;
  }
  async transact(id: string, type: string, mutate: (state?: ProgramRunV2) => ProgramRunV2,
    options: { requestId?: string; fingerprint?: string; expectedVersion?: number } = {}): Promise<ProgramRunV2> {
    const path = this.path(id), lock = `${path}.lock`, token = randomUUID(), owner = JSON.stringify({ pid: process.pid, token });
    const deadline = Date.now() + 10000, candidate = `${lock}.${token}.candidate`, claim = `${lock}.reclaim`;
    await assertAttachedSafePath(this.root, lock); await assertAttachedSafePath(this.root, candidate);
    const candidateHandle = await open(candidate, "wx", 0o600);
    try { await candidateHandle.writeFile(owner); await candidateHandle.sync(); } finally { await candidateHandle.close(); }
    try {
    for (;;) {
      try { await link(candidate, lock); break; }
      catch (error) {
        programAssert((error as NodeJS.ErrnoException).code === "EEXIST" || sharingViolation(error), "Cannot obtain program lock");
        try {
          const raw = await readFile(lock, "utf8"), previous = JSON.parse(raw);
          if (Number.isSafeInteger(previous.pid) && previous.pid > 0 && !alive(previous.pid)) {
            await assertAttachedSafePath(this.root, claim);
            try { const guard = readFileSync(claim, "utf8"), holder = JSON.parse(guard); if (Number.isSafeInteger(holder.pid) && holder.pid > 0 && !alive(holder.pid) && readFileSync(claim, "utf8") === guard) unlinkSync(claim); } catch (error) { if (!absent(error) && !(error instanceof SyntaxError)) throw error; }
            let claimed = false;
            try { await link(candidate, claim); claimed = true; if (readFileSync(lock, "utf8") === raw) unlinkSync(lock); }
            catch (error) { if (!absent(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
            finally { if (claimed) await retrySharing(() => unlink(claim)); }
          }
        }
        catch (readError) { if (!absent(readError) && !sharingViolation(readError) && !(readError instanceof SyntaxError)) throw readError; }
        programAssert(Date.now() < deadline, "Program lock busy", "AF_PROGRAM_CONFLICT"); await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    } finally { await unlink(candidate).catch(() => {}); }
    try {
      const old = await this.record(id), receipt = old?.receipts.find(entry => entry.requestId === options.requestId);
      if (receipt) { programAssert(receipt.fingerprint === options.fingerprint, "requestId body changed", "AF_PROGRAM_CONFLICT"); return old!.state; }
      programAssert(options.expectedVersion === undefined || options.expectedVersion === (old?.state.version ?? 0), "Version conflict", "AF_PROGRAM_CONFLICT");
      if (options.requestId) programAssert(typeof options.fingerprint === "string", "Request fingerprint required");
      if (type === "attempt-dispatch-intent") programAssert(!old || old.transitions.length < 90000 && Buffer.byteLength(stableStringify(old)) < 24 * 1024 * 1024, "Journal dispatch reserve exhausted; recovery remains available");
      const state = mutate(old ? structuredClone(old.state) : undefined); state.version = (old?.state.version ?? 0) + 1;
      validateWorkflowProgram(state.program, state.registry);
      const stateRef = await this.put(state, 32 * 1024 * 1024);
      const record: ProgramRecord = { state, receipts: [...(old?.receipts ?? []), ...(options.requestId ? [{ requestId: options.requestId, fingerprint: options.fingerprint!, version: state.version }] : [])],
        transitions: [...(old?.transitions ?? []), { version: state.version, type, at: new Date().toISOString(), stateDigest: programDigest(state), stateRef }] };
      const bytes = stableStringify({ record, digest: programDigest(record) }); programAssert(Buffer.byteLength(bytes) <= 32 * 1024 * 1024 && record.receipts.length <= 10000 && record.transitions.length <= 100000, "Program journal limit exceeded");
      const temp = `${path}.${token}.tmp`, handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      try { await assertAttachedSafePath(this.root, path); await retrySharing(() => rename(temp, path)); } finally { await unlink(temp).catch(() => {}); }
      return structuredClone(state);
    } finally { programAssert(await retrySharing(() => readFile(lock, "utf8")) === owner, "Program lock ownership changed"); await retrySharing(() => unlink(lock)); }
  }
}
