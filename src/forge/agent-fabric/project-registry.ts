import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
export interface FabricProject { id: string; root: string }
export interface FabricRegistryOptions { registryDirectory?: string; id?: string }
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id);
const identity = (root: string) => process.platform === "win32" ? root.toLowerCase() : root;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
const busy = (error: unknown) => ["EEXIST", "EPERM", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "");

/** Recover only a validated startup lock whose process demonstrably no longer exists. */
export async function recoverFabricLock(path: string): Promise<boolean> {
  const recovery = `${path}.recovery`;
  await checkPath(recovery);
  try { await writeFile(recovery, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (busy(error)) return false; throw error; }
  try {
    let contents: string;
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024) throw new Error("Invalid Agent Fabric startup lock");
      contents = await readFile(path, "utf8");
    } catch (error) { if (absent(error)) return true; if (busy(error)) return false; throw error; }
    if (!contents) return false; // Another process may still be completing exclusive creation.
    let pid: unknown;
    try { pid = (JSON.parse(contents) as { pid?: unknown })?.pid; } catch { throw new Error("Invalid Agent Fabric startup lock"); }
    if (!Number.isSafeInteger(pid) || (pid as number) <= 0) throw new Error("Invalid Agent Fabric startup lock pid");
    try { process.kill(pid as number, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
    // Locks are only replaced after removal. Compare bytes before deleting our observed lock.
    try { if (await readFile(path, "utf8") !== contents) return false; await unlink(path); return true; }
    catch (error) { if (absent(error)) return true; throw error; }
  } finally { await unlink(recovery); }
}

/** Git is the project authority, including when invoked from a monorepo subdirectory. */
export async function resolveFabricRoot(directory: string): Promise<string> {
  const cwd = await realpath(resolve(directory));
  const { stdout } = await execute("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  const root = await realpath(stdout.trim());
  await execute("git", ["rev-parse", "--verify", "HEAD"], { cwd: root, windowsHide: true, timeout: 10_000, maxBuffer: 16_384 });
  return root;
}

export function fabricRegistryDirectory(options: FabricRegistryOptions = {}): string {
  return resolve(options.registryDirectory ?? join(homedir(), ".forge", "agent-fabric"));
}

async function checkPath(path: string): Promise<void> {
  const parent = dirname(path);
  if (parent !== path) await checkPath(parent);
  const stat = await lstat(path).catch(error => { if (absent(error)) return undefined; throw error; });
  if (stat?.isSymbolicLink()) throw new Error("Agent Fabric registry cannot traverse symbolic links");
}

async function readRegistry(directory: string): Promise<FabricProject[]> {
  const path = join(directory, "projects.json");
  await checkPath(path);
  let data: Buffer;
  try { const stat = await lstat(path); if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("Invalid Agent Fabric registry file"); data = await readFile(path); }
  catch (error) { if (absent(error)) return []; throw error; }
  const value = JSON.parse(data.toString("utf8")) as { schemaVersion?: unknown; projects?: unknown };
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.projects) || value.projects.length > 1000) throw new Error("Invalid Agent Fabric project registry");
  const entries = value.projects as FabricProject[];
  const ids = new Set<string>(), roots = new Set<string>();
  for (const entry of entries) {
    if (!entry || Object.keys(entry).sort().join(",") !== "id,root" || typeof entry.id !== "string" || !validId(entry.id) || typeof entry.root !== "string" || !isAbsolute(entry.root) || ids.has(entry.id) || roots.has(identity(entry.root))) throw new Error("Invalid or duplicate Agent Fabric project registration");
    ids.add(entry.id); roots.add(identity(entry.root));
  }
  return entries;
}

export async function listFabricProjects(options: FabricRegistryOptions = {}): Promise<FabricProject[]> {
  return readRegistry(fabricRegistryDirectory(options));
}

export async function registerFabricProject(directory: string, options: FabricRegistryOptions = {}): Promise<FabricProject> {
  const root = await resolveFabricRoot(directory);
  const registry = fabricRegistryDirectory(options);
  const id = options.id ?? `${basename(root).replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^[^a-zA-Z0-9]+/, "").slice(0, 48) || "project"}-${createHash("sha256").update(identity(root)).digest("hex").slice(0, 12)}`;
  if (!validId(id)) throw new Error("Invalid Agent Fabric project id");
  await checkPath(registry); await mkdir(registry, { recursive: true, mode: 0o700 });
  const lock = join(registry, "projects.lock");
  const deadline = Date.now() + 5000;
  for (;;) {
    await checkPath(lock);
    try { await writeFile(lock, JSON.stringify({ pid: process.pid }), { flag: "wx", mode: 0o600 }); break; }
    catch (error) { if (!busy(error)) throw error; if (Date.now() >= deadline) throw new Error("Agent Fabric project registry is busy; retry or inspect projects.lock and projects.lock.recovery after their owners exit"); if (await recoverFabricLock(lock)) continue; await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  const stage = join(registry, `projects-${randomUUID()}.tmp`);
  try {
    const entries = await readRegistry(registry);
    const sameRoot = entries.find(entry => identity(entry.root) === identity(root));
    if (sameRoot) { if (options.id && sameRoot.id !== options.id) throw new Error("Project already registered with another id"); return sameRoot; }
    if (entries.some(entry => entry.id === id)) throw new Error("Project id already belongs to another repository");
    if (entries.length >= 1000) throw new Error("Agent Fabric project registry is full");
    const project = { id, root }; entries.push(project); entries.sort((a, b) => a.id.localeCompare(b.id));
    await writeFile(stage, `${JSON.stringify({ schemaVersion: 1, projects: entries }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    await rename(stage, join(registry, "projects.json"));
    return project;
  } finally {
    try { await unlink(stage).catch(error => { if (!absent(error)) throw error; }); }
    finally { if (await readFile(lock, "utf8") === JSON.stringify({ pid: process.pid })) await unlink(lock); }
  }
}

/** Recheck the registration so moved paths or replaced symlinks cannot redirect a run. */
export async function resolveFabricProject(id: string, options: FabricRegistryOptions = {}): Promise<string> {
  if (!validId(id)) throw new Error("Invalid Agent Fabric project id");
  const project = (await listFabricProjects(options)).find(entry => entry.id === id);
  if (!project) throw new Error("Agent Fabric project is not registered");
  const root = await resolveFabricRoot(project.root);
  if (identity(root) !== identity(project.root)) throw new Error("Agent Fabric registered repository root changed; register its new location explicitly");
  return root;
}
