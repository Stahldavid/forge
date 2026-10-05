import { mkdir, open, readFile, rename, unlink, link, lstat, realpath } from "node:fs/promises";
import { readFileSync, unlinkSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { attachedFail, attachedId, validateAttachedTaskState, type AttachedTaskState } from "./attached-task-contract.ts";
import { assertAttachedSafePath, attachedDigest } from "./attached-snapshot.ts";
import { stableStringify } from "./canonical.ts";

interface Receipt { requestId: string; fingerprint: string; response: unknown }
interface RecordFile { state: AttachedTaskState; receipts: Receipt[] }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } }
function reclaimDeadGuard(path: string): void {
  try {
    if (!lstatSync(path).isFile()) attachedFail("AF_ATTACHED_LOCK", "Unsupported reclaim guard");
    const raw = readFileSync(path, "utf8"); const owner = JSON.parse(raw);
    if (Number.isSafeInteger(owner.pid) && owner.pid > 0 && !alive(owner.pid) && readFileSync(path, "utf8") === raw) unlinkSync(path);
  } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error; }
}

/** One atomic state+receipt commit; a published hardlink lock serializes processes. */
export class AttachedTaskStore {
  private constructor(readonly root: string, readonly directory: string) {}
  static async open(root: string): Promise<AttachedTaskStore> {
    root = await realpath(root);
    const directory = join(root, ".forge", "local", "agent-fabric", "attached-tasks");
    await assertAttachedSafePath(root, directory);
    await mkdir(directory, { recursive: true });
    await assertAttachedSafePath(root, directory);
    return new AttachedTaskStore(root, directory);
  }
  private path(taskId: string): string { return join(this.directory, `${attachedId(taskId, "taskId")}.json`); }
  async read(taskId: string): Promise<AttachedTaskState> {
    const record = await this.load(taskId);
    if (!record) attachedFail("AF_ATTACHED_NOT_FOUND", "Task does not exist");
    return record.state;
  }
  private async load(taskId: string): Promise<RecordFile | undefined> {
    const path = this.path(taskId);
    await assertAttachedSafePath(this.root, path);
    try {
      if ((await lstat(path)).size > 16 * 1024 * 1024) attachedFail("AF_ATTACHED_STORE", "Task record exceeds limit");
      const envelope = JSON.parse(await readFile(path, "utf8")) as { record: RecordFile; digest: string };
      if (!envelope.record || envelope.digest !== attachedDigest(stableStringify(envelope.record))) attachedFail("AF_ATTACHED_STORE", "Task record integrity check failed");
      const record = envelope.record;
      if (record.state?.schemaVersion !== 1 || record.state.taskId !== taskId || !Array.isArray(record.receipts)) attachedFail("AF_ATTACHED_STORE", "Invalid task record");
      validateAttachedTaskState(record.state);
      for (const receipt of record.receipts) { attachedId(receipt.requestId, "requestId"); if (!/^[0-9a-f]{64}$/u.test(receipt.fingerprint)) attachedFail("AF_ATTACHED_STORE", "Invalid receipt"); }
      return record;
    } catch (error) { if (missing(error)) return undefined; throw error; }
  }
  private async lock(taskId: string): Promise<() => Promise<void>> {
    const lock = `${this.path(taskId)}.lock`;
    const token = randomUUID();
    const candidate = `${lock}.${token}.candidate`;
    const claim = `${lock}.reclaim`;
    const ownerBytes = JSON.stringify({ pid: process.pid, token });
    const deadline = Date.now() + 10000;
    await assertAttachedSafePath(this.root, candidate);
    const handle = await open(candidate, "wx", 0o600);
    try { await handle.writeFile(ownerBytes); await handle.sync(); } finally { await handle.close(); }
    try {
      while (true) {
        await assertAttachedSafePath(this.root, lock);
        try {
          await link(candidate, lock);
          return async () => { await assertAttachedSafePath(this.root, lock); if (await readFile(lock, "utf8") !== ownerBytes) attachedFail("AF_ATTACHED_LOCK", "Lock ownership changed"); await unlink(lock); };
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        try {
          if (!(await lstat(lock)).isFile()) attachedFail("AF_ATTACHED_LOCK", "Unsupported old or malformed lock; inspect before removing");
          const raw = await readFile(lock, "utf8"); const previous = JSON.parse(raw);
          if (Number.isSafeInteger(previous.pid) && previous.pid > 0 && !alive(previous.pid)) {
            await assertAttachedSafePath(this.root, claim);
            reclaimDeadGuard(claim);
            let claimed = false;
            try {
              await link(candidate, claim); claimed = true;
              if (readFileSync(lock, "utf8") === raw) unlinkSync(lock);
            } catch (error) { if (!missing(error) && (error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
            finally { if (claimed) await unlink(claim).catch(() => {}); }
          }
        } catch (error) { if (!missing(error) && !(error instanceof SyntaxError)) throw error; }
        if (Date.now() >= deadline) attachedFail("AF_ATTACHED_LOCK_BUSY", "Task is locked; retry after its owner exits");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally { await unlink(candidate).catch(() => {}); }
  }
  async mutate(taskId: string, requestId: string, fingerprint: string, expectedVersion: number | undefined, apply: (state: AttachedTaskState | undefined) => Promise<{ state: AttachedTaskState; response: unknown }>): Promise<unknown> {
    const release = await this.lock(taskId);
    try {
      const old = await this.load(taskId);
      const receipt = old?.receipts.find((item) => item.requestId === requestId);
      if (receipt) { if (receipt.fingerprint !== fingerprint) attachedFail("AF_ATTACHED_REQUEST_CONFLICT", "requestId was already used with different input"); return receipt.response; }
      if (old && old.state.version !== expectedVersion) attachedFail("AF_ATTACHED_VERSION_CONFLICT", `Expected version ${old.state.version}`);
      if (!old && expectedVersion !== undefined) attachedFail("AF_ATTACHED_NOT_FOUND", "Task does not exist");
      const result = await apply(old?.state);
      const record: RecordFile = { state: result.state, receipts: [...(old?.receipts ?? []), { requestId, fingerprint, response: result.response }] };
      validateAttachedTaskState(record.state);
      const data = stableStringify({ record, digest: attachedDigest(stableStringify(record)) });
      if (Buffer.byteLength(data) > 16 * 1024 * 1024) attachedFail("AF_ATTACHED_STORE", "Task record exceeds limit");
      const temp = `${this.path(taskId)}.${randomUUID()}.tmp`;
      await assertAttachedSafePath(this.root, temp);
      const handle = await open(temp, "wx", 0o600);
      try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
      try { await assertAttachedSafePath(this.root, this.path(taskId)); await rename(temp, this.path(taskId)); } finally { await unlink(temp).catch(() => {}); }
      return result.response;
    } finally { await release(); }
  }
}
