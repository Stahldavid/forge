import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { stableStringify } from "./canonical.ts";

type Manager = "npm" | "pnpm" | "yarn" | "bun" | "none";
export interface ManagedEnvironmentOptions { mode?: "auto" | "none"; ignoreScripts?: boolean; registry?: string; timeoutMs?: number; cacheDirectory?: string; signal?: AbortSignal;
  onTiming?: (measurement: { phase: "cache.verify" | "cache.copy" | "dependencies.install"; elapsedMs: number }) => Promise<void> | void }
export interface ManagedEnvironment { schemaVersion: 1; directory: string; manager: Manager; lockDigest: string; dependencyDigest: string; derivedPaths: string[]; cacheHit: boolean }
const execute = promisify(execFile);
const hash = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(`managed environment: ${message}`); }
function inside(root: string, target: string) { const path = relative(root, target); return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`)); }
async function exists(path: string) { try { await access(path); return true; } catch (error) { if (absent(error)) return false; throw error; } }
function aborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error("managed environment: preparation canceled"); }
async function cleanupOwned(path: string, parent: string, kind: "home" | "stage" | "cache"): Promise<void> {
  const ownedName = path.slice(dirname(path).length + 1);
  assert(resolve(dirname(path)) === resolve(parent) && (kind === "home" ? /^forge-managed-install-home-[a-zA-Z0-9]+$/.test(ownedName) : kind === "cache" ? /^[a-f0-9]{64}$/.test(ownedName) : /^[a-f0-9]{64}-[a-f0-9-]{36}\.stage$/.test(ownedName)), "refusing cleanup of unowned directory");
  try { const stat = await lstat(path); assert(stat.isDirectory() && !stat.isSymbolicLink(), "refusing cleanup of substituted owned directory"); await rm(path, { recursive: true, force: true, maxRetries: 4, retryDelay: 20 }); }
  catch (error) { if (!absent(error)) throw error; }
}
/** Only safe OS bootstrapping variables survive. Package-manager HOME/configs are private. */
export function managedInstallEnvironment(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (["PATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG", "LC_ALL"].includes(key.toUpperCase())) env[key] = value;
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, CI: "1", NPM_CONFIG_USERCONFIG: join(home, "npmrc"), NPM_CONFIG_GLOBALCONFIG: join(home, "global-npmrc"), BUN_CONFIG_NO_CLEAR_TERMINAL: "1" };
}
async function managerCommand(manager: Exclude<Manager, "none">): Promise<{ executable: string; prefix: string[] }> {
  const names = process.platform === "win32" ? [`${manager}.exe`, `${manager}.cmd`] : [manager];
  const pathValue = Object.entries(process.env).find(([key]) => key.toUpperCase() === "PATH")?.[1] ?? "";
  for (const directory of pathValue.split(process.platform === "win32" ? ";" : ":")) for (const name of names) {
    const candidate = join(directory, name); if (!await exists(candidate)) continue;
    if (!name.endsWith(".cmd")) return { executable: candidate, prefix: [] };
    const scripts = manager === "npm" ? ["node_modules/npm/bin/npm-cli.js"] : manager === "pnpm" ? ["node_modules/pnpm/bin/pnpm.cjs", "node_modules/corepack/dist/pnpm.js"] : manager === "yarn" ? ["node_modules/yarn/bin/yarn.js", "node_modules/corepack/dist/yarn.js"] : [];
    for (const script of scripts) if (await exists(join(directory, script))) return { executable: process.execPath, prefix: [join(directory, script)] };
  }
  throw new Error(`managed environment: ${manager} executable unavailable; install the project's declared package manager`);
}
async function sourceManifests(directory: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (root: string) => { for (const item of await readdir(root, { withFileTypes: true })) {
    if ([".git", "node_modules", ".forge", ".yarn"].includes(item.name)) continue;
    const target = join(root, item.name); assert(!item.isSymbolicLink(), "source symlink rejected during environment preparation");
    if (item.isDirectory()) await visit(target); else if (item.name === "package.json") { assert(result.length < 1000, "too many Node manifests"); result.push(relative(directory, target).split(sep).join("/")); }
  } };
  await visit(directory); return result.sort();
}
async function derivePaths(directory: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (root: string) => { for (const item of await readdir(root, { withFileTypes: true })) {
    if (item.name === ".git") continue;
    const path = join(root, item.name);
    if (item.name === "node_modules") { assert(item.isDirectory() && !item.isSymbolicLink(), "derived root cannot link to shared dependencies"); result.push(relative(directory, path).split(sep).join("/")); }
    else if (item.isDirectory() && !item.isSymbolicLink()) await visit(path);
  } };
  await visit(directory); return result.sort();
}
async function portableLinks(directory: string, paths: string[]) {
  const visit = async (absolute: string): Promise<void> => {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      if (isAbsolute(target)) {
        const actual = await realpath(absolute); assert(inside(directory, actual), "installed dependency links outside checkout");
        const type = (await lstat(actual)).isDirectory() ? "dir" : "file";
        // Windows junctions require no symlink privilege and already target this isolated checkout.
        if (process.platform === "win32" && type === "dir") return;
        await unlink(absolute); await symlink(relative(dirname(absolute), actual), absolute, type);
      }
    } else if (stat.isDirectory()) for (const name of await readdir(absolute)) await visit(join(absolute, name));
  };
  for (const path of paths) await visit(join(directory, path));
}
/** Copy dependency bytes; remap internal workspace links into the receiving isolated tree. */
async function copyDependencyPaths(sourceRoot: string, targetRoot: string, paths: string[], signal?: AbortSignal) {
  let entries = 0, bytes = 0;
  const visit = async (source: string, target: string): Promise<void> => {
    aborted(signal); assert(++entries <= 200000 && inside(sourceRoot, source) && inside(targetRoot, target), "dependency copy bound or path escape");
    const stat = await lstat(source);
    if (stat.isSymbolicLink()) {
      const link = await readlink(source), sourceTarget = resolve(dirname(source), link); assert(inside(sourceRoot, sourceTarget), "dependency copy link escapes source tree");
      let directoryLink = process.platform === "win32";
      try { const actual = await realpath(source); assert(inside(sourceRoot, actual), "dependency copy link resolves outside source tree"); directoryLink = (await lstat(actual)).isDirectory(); } catch (error) { if (!absent(error)) throw error; }
      const receiver = resolve(targetRoot, relative(sourceRoot, sourceTarget)); assert(inside(targetRoot, receiver), "dependency copy link escapes receiving tree");
      await mkdir(dirname(target), { recursive: true });
      await symlink(process.platform === "win32" && directoryLink ? receiver : relative(dirname(target), receiver), target, directoryLink ? (process.platform === "win32" ? "junction" : "dir") : "file");
    } else if (stat.isDirectory()) { await mkdir(target, { recursive: true }); for (const name of (await readdir(source)).sort()) await visit(join(source, name), join(target, name)); }
    else { assert(stat.isFile() && stat.nlink === 1, "dependency copy cannot share hardlinked bytes"); bytes += stat.size; assert(bytes <= 4 * 1024 * 1024 * 1024, "dependency copy byte bound exceeded"); await mkdir(dirname(target), { recursive: true }); await cp(source, target, { force: false, errorOnExist: true }); }
  };
  for (const path of paths) await visit(join(sourceRoot, path), join(targetRoot, path));
}
async function rebaseCacheJunctions(directory: string, previous: string, paths: string[]) {
  if (process.platform !== "win32") return;
  const visit = async (absolute: string): Promise<void> => {
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const link = await readlink(absolute);
      if (isAbsolute(link)) {
        assert(inside(previous, resolve(link)), "cache junction relocation escapes owned tree");
        const target = resolve(directory, relative(previous, resolve(link))); assert(inside(directory, target), "cache junction escapes published tree");
        await unlink(absolute); await symlink(target, absolute, "junction");
      }
    } else if (stat.isDirectory()) for (const name of await readdir(absolute)) await visit(join(absolute, name));
  };
  for (const path of paths) await visit(join(directory, path));
}
/** Streaming dependency scan: 200k entries/4GiB, separately from bounded source snapshots. */
async function dependencyDigest(directory: string, paths: string[], signal?: AbortSignal): Promise<string> {
  const entries: { path: string; digest: string; mode?: number }[] = []; let bytes = 0;
  const visit = async (path: string) => {
    aborted(signal); assert(entries.length < 200000, "dependency entry bound exceeded"); const absolute = resolve(directory, path); assert(inside(directory, absolute), "dependency path escape");
    const stat = await lstat(absolute);
    if (stat.isSymbolicLink()) {
      const target = await readlink(absolute); assert(inside(directory, resolve(dirname(absolute), target)), "dependency symlink escapes isolated checkout");
      try { assert(inside(directory, await realpath(absolute)), "dependency symlink resolves outside isolated checkout"); } catch (error) { if (!absent(error)) throw error; }
      entries.push({ path, digest: hash(`link:${relative(dirname(absolute), resolve(dirname(absolute), target)).split(sep).join("/")}`) });
    } else if (stat.isDirectory()) { entries.push({ path, digest: hash("directory") }); for (const name of (await readdir(absolute)).sort()) await visit(`${path}/${name}`); }
    else {
      assert(stat.isFile() && stat.nlink === 1, "dependency files cannot share writable hardlinks"); bytes += stat.size; assert(bytes <= 4 * 1024 * 1024 * 1024, "dependency byte bound exceeded");
      const digest = createHash("sha256"); for await (const chunk of createReadStream(absolute)) { aborted(signal); digest.update(chunk as Buffer); }
      entries.push({ path, digest: `sha256:${digest.digest("hex")}`, mode: stat.mode & 0o111 ? 0o755 : 0o644 });
    }
  };
  assert(paths.length <= 1000 && new Set(paths).size === paths.length, "invalid derived paths");
  for (const path of [...paths].sort()) { assert(!isAbsolute(path) && !path.includes("\\") && path.split("/").every(part => part && part !== "." && part !== "..") && (path.split("/").at(-1) === "node_modules" || [".yarn/install-state.gz", ".yarn/cache"].includes(path)), "invalid derived directory"); await visit(path); }
  return hash(stableStringify(entries));
}
export async function verifyManagedEnvironment(environment: ManagedEnvironment): Promise<void> {
  assert(environment?.schemaVersion === 1 && environment.directory === resolve(environment.directory) && ["npm", "pnpm", "yarn", "bun", "none"].includes(environment.manager), "invalid coordinator environment");
  assert(await dependencyDigest(environment.directory, environment.derivedPaths) === environment.dependencyDigest, "prepared dependencies were modified; result is invalid");
}
export async function prepareManagedEnvironment(directory: string, options: ManagedEnvironmentOptions = {}): Promise<ManagedEnvironment> {
  const timed = async <T>(phase: "cache.verify" | "cache.copy" | "dependencies.install", operation: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try { return await operation(); }
    finally { await options.onTiming?.({ phase, elapsedMs: performance.now() - start }); }
  };
  directory = resolve(directory); aborted(options.signal);
  assert(!(await lstat(directory)).isSymbolicLink(), "workspace root cannot be a symlink");
  const none = (): ManagedEnvironment => ({ schemaVersion: 1, directory, manager: "none", lockDigest: hash("none"), dependencyDigest: hash(stableStringify([])), derivedPaths: [], cacheHit: false });
  if (options.mode === "none" || !await exists(join(directory, "package.json"))) return none();
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  const candidates: { manager: Exclude<Manager, "none">; file: string }[] = [];
  for (const [manager, file] of [["npm", "package-lock.json"], ["pnpm", "pnpm-lock.yaml"], ["yarn", "yarn.lock"], ["bun", "bun.lock"], ["bun", "bun.lockb"]] as const) if (await exists(join(directory, file))) candidates.push({ manager, file });
  const declared = typeof manifest.packageManager === "string" ? manifest.packageManager.split("@")[0] : undefined;
  const selected = declared ? candidates.filter(candidate => candidate.manager === declared) : candidates;
  assert(selected.length === 1, "requires one deterministic frozen lockfile matching packageManager; missing or ambiguous lockfiles");
  const { manager, file } = selected[0], command = await managerCommand(manager), home = await mkdtemp(join(tmpdir(), "forge-managed-install-home-"));
  let stage: string | undefined, stageParent: string | undefined, uncommittedCache: string | undefined;
  try {
  await writeFile(join(home, "npmrc"), ""); await writeFile(join(home, "global-npmrc"), "");
  const env = managedInstallEnvironment(home), registry = options.registry ?? "https://registry.npmjs.org/", url = new URL(registry);
  assert(url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash, "registry must be a public HTTPS endpoint without credentials");
  const timeout = options.timeoutMs ?? 180000; assert(Number.isSafeInteger(timeout) && timeout >= 100 && timeout <= 1800000, "invalid install timeout");
  const version = (await execute(command.executable, [...command.prefix, "--version"], { cwd: directory, env, windowsHide: true, timeout: Math.min(timeout, 30000), signal: options.signal })).stdout.trim();
  const manifests = await sourceManifests(directory), inputs = await Promise.all(manifests.map(async path => ({ path, digest: hash(await readFile(join(directory, path))) })));
  const lockDigest = hash(stableStringify({ cacheSchema: 2, lock: hash(await readFile(join(directory, file))), manifests: inputs, manager, version, node: process.versions.node, platform: process.platform, arch: process.arch, registry, ignoreScripts: options.ignoreScripts !== false }));
  const cacheRoot = resolve(options.cacheDirectory ?? join(tmpdir(), "forge-managed-dependency-cache"));
  stageParent = cacheRoot;
  assert(!inside(directory, cacheRoot), "dependency cache must be outside worker checkout"); await mkdir(cacheRoot, { recursive: true }); assert(!(await lstat(cacheRoot)).isSymbolicLink(), "cache root cannot be a symlink");
  const cache = join(cacheRoot, lockDigest.slice(7)), marker = join(cache, "environment.json");
  if (await exists(marker)) {
    const cached = JSON.parse(await readFile(marker, "utf8")) as ManagedEnvironment;
    await timed("cache.verify", async () => { assert(cached.lockDigest === lockDigest && cached.dependencyDigest === await dependencyDigest(join(cache, "tree"), cached.derivedPaths, options.signal), "dependency cache integrity failed"); });
    await timed("cache.copy", () => copyDependencyPaths(join(cache, "tree"), directory, cached.derivedPaths, options.signal));
    const environment = { ...cached, directory, cacheHit: true }; await timed("cache.verify", () => verifyManagedEnvironment(environment)); return environment;
  }
  const configBackups: { path: string; bytes?: Buffer }[] = [];
  try {
    for (const parent of new Set(manifests.map(path => dirname(join(directory, path))))) for (const name of [".npmrc", ".yarnrc", ".yarnrc.yml", "bunfig.toml", ".env", ".env.local", ".env.development", ".env.production"]) {
      const path = join(parent, name); let bytes: Buffer | undefined;
      try { assert(!(await lstat(path)).isSymbolicLink(), "package config cannot be a symlink"); bytes = await readFile(path); } catch (error) { if (!absent(error)) throw error; }
      if (bytes !== undefined) { configBackups.push({ path, bytes }); await writeFile(path, ""); }
    }
    const ignore = options.ignoreScripts !== false;
    const args = manager === "npm" ? ["ci", "--no-audit", "--no-fund", `--registry=${registry}`, ...(ignore ? ["--ignore-scripts"] : [])]
      : manager === "pnpm" ? ["install", "--frozen-lockfile", "--package-import-method=copy", `--registry=${registry}`, ...(ignore ? ["--ignore-scripts"] : [])]
      : manager === "bun" ? ["install", "--frozen-lockfile", "--backend=copyfile", `--registry=${registry}`, ...(ignore ? ["--ignore-scripts"] : [])]
      : Number.parseInt(version) >= 2 ? ["install", "--immutable", ...(ignore ? ["--mode=skip-builds"] : [])] : ["install", "--frozen-lockfile", "--non-interactive", `--registry=${registry}`, ...(ignore ? ["--ignore-scripts"] : [])];
    env.YARN_NODE_LINKER = "node-modules"; env.YARN_NM_MODE = "classic"; env.YARN_ENABLE_GLOBAL_CACHE = "false"; env.YARN_NPM_REGISTRY_SERVER = registry; env.YARN_ENABLE_SCRIPTS = ignore ? "false" : "true";
    env.NPM_CONFIG_CACHE = join(cacheRoot, "download-cache"); env.BUN_INSTALL_CACHE_DIR = join(cacheRoot, "bun-download-cache"); env.COREPACK_HOME = join(cacheRoot, "corepack-cache");
    await timed("dependencies.install", () => execute(command.executable, [...command.prefix, ...args], { cwd: directory, env, windowsHide: true, timeout, signal: options.signal, maxBuffer: 1024 * 1024 }));
  } catch (error) { if (options.signal?.aborted) throw new Error("managed environment: preparation canceled"); throw new Error(`managed environment: frozen ${manager} install failed: ${(error as Error).message.slice(0, 2000)}`); }
  finally { for (const config of configBackups) await writeFile(config.path, config.bytes!); }
  aborted(options.signal); const derivedPaths = await derivePaths(directory);
  if (manager === "yarn") for (const path of [".yarn/install-state.gz", ".yarn/cache"]) if (await exists(join(directory, path))) derivedPaths.push(path);
  derivedPaths.sort(); await portableLinks(directory, derivedPaths); const dependency = await dependencyDigest(directory, derivedPaths, options.signal);
  const environment: ManagedEnvironment = { schemaVersion: 1, directory, manager, lockDigest, dependencyDigest: dependency, derivedPaths, cacheHit: false };
  stage = join(cacheRoot, `${lockDigest.slice(7)}-${randomUUID()}.stage`); await mkdir(join(stage, "tree"), { recursive: true });
  await timed("cache.copy", () => copyDependencyPaths(directory, join(stage!, "tree"), derivedPaths, options.signal));
  await timed("cache.verify", async () => { assert(await dependencyDigest(join(stage!, "tree"), derivedPaths, options.signal) === dependency, "cache copy integrity failed"); });
  try {
    await rename(stage, cache); uncommittedCache = cache;
    await rebaseCacheJunctions(join(cache, "tree"), join(stage, "tree"), derivedPaths);
    await timed("cache.verify", async () => { assert(await dependencyDigest(join(cache, "tree"), derivedPaths, options.signal) === dependency, "published cache integrity failed"); });
    const markerTemp = join(cache, "environment.json.tmp");
    await writeFile(markerTemp, stableStringify(environment)); await rename(markerTemp, join(cache, "environment.json")); uncommittedCache = undefined;
  } catch (error) { if (uncommittedCache || !["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error; }
  return environment;
  } finally {
    // Cleanup never masks the original preparation error. Cache entries and worker trees are retained.
    await cleanupOwned(home, tmpdir(), "home").catch(() => {});
    if (stage && stageParent) await cleanupOwned(stage, stageParent, "stage").catch(() => {});
    if (uncommittedCache && stageParent) await cleanupOwned(uncommittedCache, stageParent, "cache").catch(() => {});
  }
}
