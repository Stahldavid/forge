import { link, open, readFile, unlink } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { programAssert } from "./program-contract.ts";

const code = (error: unknown) => (error as NodeJS.ErrnoException).code;
const transient = (error: unknown) => ["ENOENT", "EEXIST", "EPERM", "EACCES", "EBUSY"].includes(code(error) ?? "");
function dead(bytes: string): boolean {
  const holder = JSON.parse(bytes) as { pid: number };
  if (!Number.isSafeInteger(holder.pid) || holder.pid <= 0) return false;
  try { process.kill(holder.pid, 0); return false; } catch (error) { return code(error) === "ESRCH"; }
}
/** Shared local hardlink protocol. Only a confirmed dead holder may be reclaimed. */
export class ProgramFileLease {
  private constructor(readonly path: string, readonly token: string, private bytes: string, private lostMessage: string) {}
  static async acquire(path: string, options: { waitMs?: number; busyCode?: string; busyMessage?: string; lostMessage?: string } = {}): Promise<ProgramFileLease> {
    const token = randomUUID(), bytes = JSON.stringify({ pid: process.pid, token });
    const candidate = `${path}.${token}.candidate`, reclaim = `${path}.reclaim`, deadline = Date.now() + (options.waitMs ?? 0);
    const handle = await open(candidate, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      for (;;) {
        try { await link(candidate, path); return new ProgramFileLease(path, token, bytes, options.lostMessage ?? "Program lock ownership changed"); }
        catch (error) { if (!transient(error)) throw error; }
        let reclaimed = false;
        try {
          const old = await readFile(path, "utf8");
          if (dead(old)) {
            try { const guard = readFileSync(reclaim, "utf8"); if (dead(guard) && readFileSync(reclaim, "utf8") === guard) unlinkSync(reclaim); }
            catch (error) { if (!transient(error) && !(error instanceof SyntaxError)) throw error; }
            let claimed = false;
            try {
              await link(candidate, reclaim); claimed = true;
              if (readFileSync(path, "utf8") === old) { unlinkSync(path); reclaimed = true; }
            } finally {
              if (claimed) { programAssert(readFileSync(reclaim, "utf8") === bytes, "Reclaim identity changed"); unlinkSync(reclaim); }
            }
          }
        } catch (error) { if (!transient(error) && !(error instanceof SyntaxError)) throw error; }
        if (reclaimed) continue;
        programAssert(Date.now() < deadline, options.busyMessage ?? "Program lock busy", options.busyCode ?? "AF_PROGRAM_CONFLICT");
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    } finally { await unlink(candidate).catch(() => {}); }
  }
  async assert(): Promise<void> { programAssert(await readFile(this.path, "utf8") === this.bytes, this.lostMessage); }
  async close(): Promise<void> {
    programAssert(readFileSync(this.path, "utf8") === this.bytes, this.lostMessage); unlinkSync(this.path);
  }
}
