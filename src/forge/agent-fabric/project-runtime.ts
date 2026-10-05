import { spawn, execFile } from "node:child_process";
import { lstat, mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { localFabricPath } from "./local-paths.ts";
import { probeLocalOwner } from "./local-task-server.ts";
import { recoverFabricLock, resolveFabricRoot } from "./project-registry.ts";
import { readFabricProfile } from "./project-profile.ts";

const execute = promisify(execFile);
const cliPath = fileURLToPath(new URL("../../../bin/forge.mjs", import.meta.url));
export interface FabricOwnerOptions { cliPath?: string; nodeExecutable?: string; startupTimeoutMs?: number }
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function fabricProjectDoctor(directory: string) {
  const root = await resolveFabricRoot(directory);
  const profile = await readFabricProfile(root);
  const owner = await probeLocalOwner(root).then(value => ({ running: value !== null, ...(value ?? {}) })).catch(error => ({ running: false, error: error instanceof Error ? error.message : "Owner probe failed" }));
  const sdkAvailable = await import("@openai/codex-sdk").then(module => typeof module.Codex === "function").catch(() => false);
  const auth = await execute("codex", ["login", "status"], { windowsHide: true, timeout: 5000, maxBuffer: 8192 }).then(() => "authenticated" as const).catch(() => "not_verified" as const);
  return { ok: sdkAvailable && !("error" in owner), repositoryRoot: root,
    runtime: { cliPath, nodeExecutable: process.execPath, sdkAvailable }, owner, profile,
    codexAuthentication: auth, managedExecution: true, hooksRequired: false,
    nextActions: [...(!sdkAvailable ? ["Install the selected Forge runtime's dependencies"] : []), ...(!owner.running ? ["forge fabric ensure-owner --json"] : []), ...(auth !== "authenticated" ? ["codex login status"] : [])] };
}

/** Start only an owner, never a worker, and reuse an authenticated owner for this exact root. */
export async function ensureFabricOwner(directory: string, options: FabricOwnerOptions = {}): Promise<{ repositoryRoot: string; pid: number; port: number; started: boolean }> {
  const root = await resolveFabricRoot(directory);
  const existing = await probeLocalOwner(root);
  if (existing) return { ...existing, started: false };
  const state = localFabricPath(root);
  await mkdir(state, { recursive: true, mode: 0o700 });
  const lock = localFabricPath(root, "owner-start.lock");
  const deadline = Date.now() + (options.startupTimeoutMs ?? 30_000);
  for (;;) {
    try { await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); break; }
    catch (error) {
      if (!["EEXIST", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      const peer = await probeLocalOwner(root); if (peer) return { ...peer, started: false };
      // Never recover a live or unverified process's lock solely on a timer.
      if (Date.now() >= deadline) throw new Error("Agent Fabric owner startup is busy; inspect owner-start.lock and owner-start.lock.recovery after their processes exit");
      if (await recoverFabricLock(lock)) continue;
      await delay(100);
    }
  }
  try {
    const peer = await probeLocalOwner(root); if (peer) return { ...peer, started: false };
    const logPath = localFabricPath(root, "owner.log");
    const stat = await lstat(logPath).catch(error => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
    if (stat && !stat.isFile()) throw new Error("Agent Fabric owner log is not a regular file");
    let node = options.nodeExecutable ?? process.execPath;
    if (!options.nodeExecutable && process.versions.bun) node = (await execute("node", ["-p", "process.execPath"], { windowsHide: true, timeout: 5000 })).stdout.trim();
    const log = await open(logPath, "a", 0o600);
    let child: ReturnType<typeof spawn>;
    let failure: string | undefined;
    try {
      child = spawn(node, [options.cliPath ?? cliPath, "fabric", "serve", "--json"], {
        cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log.fd, log.fd],
      });
      child.once("error", error => { failure = error.message; });
      child.once("exit", (code, signal) => { failure = `owner exited (${code ?? signal})`; });
    } finally { await log.close(); }
    child.unref();
    try {
      while (Date.now() < deadline) {
        const owner = await probeLocalOwner(root);
        if (owner) {
          if (owner.pid !== child.pid) child.kill();
          return { ...owner, started: owner.pid === child.pid };
        }
        if (failure) throw new Error(`Agent Fabric ${failure}; inspect ${logPath}`);
        await delay(100);
      }
      throw new Error(`Agent Fabric owner startup timed out; inspect ${logPath}`);
    } catch (error) {
      // Only this exact spawned child is ours to stop if startup did not complete.
      child.kill();
      throw error;
    }
  } finally {
    const contents = await readFile(lock, "utf8");
    if (contents === JSON.stringify({ pid: process.pid })) await unlink(lock);
  }
}
