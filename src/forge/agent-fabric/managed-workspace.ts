import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { stableStringify } from "./canonical.ts";
import { verifyManagedEnvironment, type ManagedEnvironment } from "./managed-environment.ts";

export interface ManagedBase { root: string; runId: string; head: string; scope: string[]; digest: string; baselineDirectory: string; contextScope?: string[]; contextDigest?: string }
export interface ManagedFile { path: string; beforeDigest: string | null; contentBase64: string | null; mode?: number }
export interface ManagedArtifact { digest: string; files: ManagedFile[] }
interface Entry { path: string; digest: string; mode: number; contentBase64?: string; readonlySize?: number }
interface Inventory { files: Entry[]; digest: string }
interface WorkspaceMetadata { baseDigest: string; runId: string; attemptId: string; directory: string; input: Inventory }
const runFile = promisify(execFile);
// Baselines include generated Forge graphs (~10MiB); output artifacts retain the smaller bound.
const MAX_FILES = 20_000, MAX_BYTES = 128 * 1024 * 1024, MAX_SNAPSHOT_FILE_BYTES = 16 * 1024 * 1024, MAX_ARTIFACT_FILE_BYTES = 8 * 1024 * 1024;
// Large assets outside the editable/context scope stay in Git clones. Only their
// streaming fingerprints enter inventories; editable snapshots retain their limits.
const MAX_READONLY_ASSET_BYTES = 512 * 1024 * 1024, MAX_READONLY_BYTES = 1024 * 1024 * 1024;
const hash = (data: string | Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(`managed workspace: ${message}`); }
function pathName(value: string): string {
  assert(typeof value === "string" && value.length > 0 && !isAbsolute(value) && !/[\\:\x00]/.test(value), "invalid relative path");
  const parts = value.split("/"); assert(parts.every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git"), "unsafe path");
  assert(!parts.some(part => /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)), "unsafe Windows path");
  return value;
}
function scopes(input: string[]): string[] { assert(Array.isArray(input) && input.length > 0 && input.length <= 1000, "scope required"); const result = input.map(pathName); assert(result.every(path => path.toLowerCase() !== ".forge" && !path.toLowerCase().startsWith(".forge/")), "owned .forge metadata cannot be task scope"); assert(new Set(result.map(path => path.toLowerCase())).size === result.length, "duplicate scope"); return result.sort(); }
const withinScope = (path: string, scope: string[]) => scope.some(item => path === item || path.startsWith(`${item}/`));
async function safePath(root: string, path: string): Promise<string> {
  pathName(path); const absolute = resolve(root, path), rel = relative(resolve(root), absolute);
  assert(rel && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), "path escapes directory");
  let cursor = resolve(root); assert(!(await lstat(cursor)).isSymbolicLink(), "symlink root rejected");
  for (const part of path.split("/")) { cursor = join(cursor, part); try { assert(!(await lstat(cursor)).isSymbolicLink(), "symlink rejected"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") break; throw error; } }
  return absolute;
}
async function git(root: string, args: string[]) { return (await runFile("git", ["-C", root, ...args], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })).stdout.trim(); }
const contextNames = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", ".yarnrc.yml", "bun.lock", "bun.lockb", "bunfig.toml", "forge.manifest.json"];
async function readonlyContextPaths(root: string, scope: string[]): Promise<string[]> {
  const tracked = (await git(root, ["ls-files", "-z"])).split("\0").filter(Boolean);
  const result = new Set(tracked.filter(path => contextNames.includes(path.split("/").at(-1)!) && !withinScope(path, scope)));
  for (const name of contextNames) try { await lstat(join(root, name)); if (!withinScope(name, scope)) result.add(name); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const paths = [...result].sort(); assert(paths.length <= 1000, "context metadata count exceeded"); for (const path of paths) pathName(path); return paths;
}
async function currentContextMatches(base: ManagedBase): Promise<boolean> {
  return base.contextScope === undefined || (await inventory(base.root, base.contextScope)).digest === base.contextDigest;
}
function inventoryDigest(files: Entry[]): string {
  return hash(JSON.stringify(files.map(({ path, digest, mode, readonlySize }) => ({ path, digest, mode, ...(readonlySize === undefined ? {} : { readonlySize }) }))));
}
function entryContent(file: Entry): string { assert(typeof file.contentBase64 === "string" && file.readonlySize === undefined, "read-only asset cannot be materialized or published"); return file.contentBase64; }
async function readonlyAssetDigest(absolute: string, size: number): Promise<string> {
  const handle = await open(absolute, "r");
  try {
    const before = await handle.stat();
    assert(before.isFile() && before.size === size, "asset changed before hashing");
    const digest = createHash("sha256"); let bytes = 0;
    for await (const chunk of handle.createReadStream({ autoClose: false, highWaterMark: 256 * 1024 })) {
      bytes += chunk.length; assert(bytes <= size && bytes <= MAX_READONLY_ASSET_BYTES, "asset changed or size bound exceeded"); digest.update(chunk);
    }
    const after = await handle.stat(), current = await lstat(absolute);
    assert(bytes === size && after.size === before.size && after.mtimeMs === before.mtimeMs && after.ctimeMs === before.ctimeMs
      && current.isFile() && !current.isSymbolicLink() && current.ino === before.ino && current.size === before.size
      && current.mtimeMs === before.mtimeMs && current.ctimeMs === before.ctimeMs, "asset changed during hashing");
    return `sha256:${digest.digest("hex")}`;
  } finally { await handle.close(); }
}
async function inventory(root: string, scope?: string[], excluded: string[] = [], boundedScope: string[] = []): Promise<Inventory> {
  const files: Entry[] = []; let bytes = 0, readonlyBytes = 0;
  const visit = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      if (!prefix && name.toLowerCase() === ".git") continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (excluded.some(item => path === item || path.startsWith(`${item}/`))) continue;
      if (scope && !withinScope(path, scope) && !scope.some(item => item.startsWith(`${path}/`))) continue;
      pathName(path); const absolute = await safePath(root, path), stat = await lstat(absolute);
      assert(!stat.isSymbolicLink(), "symlink rejected");
      if (stat.isDirectory()) await visit(absolute, path);
      else {
        assert(stat.isFile(), "special file rejected"); assert(files.length < MAX_FILES, "snapshot bound exceeded");
        if (stat.size > MAX_SNAPSHOT_FILE_BYTES && !scope && !withinScope(path, boundedScope)) {
          readonlyBytes += stat.size;
          assert(stat.size <= MAX_READONLY_ASSET_BYTES && readonlyBytes <= MAX_READONLY_BYTES, "read-only asset size bound exceeded");
          files.push({ path, digest: await readonlyAssetDigest(absolute, stat.size), mode: stat.mode & 0o111 ? 0o755 : 0o644, readonlySize: stat.size });
          continue;
        }
        assert(stat.size <= MAX_SNAPSHOT_FILE_BYTES, "file size bound exceeded");
        const content = await readFile(absolute); bytes += content.length;
        assert(bytes <= MAX_BYTES && files.length < MAX_FILES, "snapshot bound exceeded");
        files.push({ path, digest: hash(content), mode: stat.mode & 0o111 ? 0o755 : 0o644, contentBase64: content.toString("base64") });
      }
    }
  };
  await visit(resolve(root), ""); files.sort((a, b) => a.path.localeCompare(b.path));
  assert(new Set(files.map(file => file.path.toLowerCase())).size === files.length, "case-colliding paths rejected");
  return { files, digest: inventoryDigest(files) };
}
function workspaceInventory(base: ManagedBase, directory: string, excluded: string[] = []): Promise<Inventory> {
  return inventory(directory, undefined, excluded, [...base.scope, ...(base.contextScope ?? [])]);
}
async function setFile(root: string, file: { path: string; contentBase64?: string | null; mode?: number }) {
  const absolute = await safePath(root, file.path);
  if (file.contentBase64 === null) { try { const stat = await lstat(absolute); assert(stat.isFile(), "delete target is not a regular file"); await rm(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } return; }
  assert(typeof file.contentBase64 === "string", "read-only asset cannot be materialized or published");
  await mkdir(dirname(absolute), { recursive: true }); await writeFile(absolute, Buffer.from(file.contentBase64, "base64")); await chmod(absolute, file.mode ?? 0o644);
}
async function clone(root: string, prefix: string): Promise<string> {
  const owned = await mkdtemp(join(tmpdir(), prefix)), directory = join(owned, "checkout");
  await runFile("git", ["clone", "--quiet", "--no-hardlinks", "--no-checkout", "--", root, directory], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return directory;
}
function artifactDigest(files: ManagedFile[]) { return hash(stableStringify(files)); }
function validateArtifact(artifact: ManagedArtifact, scope: string[]) {
  assert(artifact && Object.keys(artifact).every(key => ["digest", "files"].includes(key)) && Array.isArray(artifact.files), "invalid artifact");
  assert(artifact.files.length <= MAX_FILES, "artifact count bound exceeded"); let bytes = 0;
  const paths = new Set<string>();
  for (const file of artifact.files) {
    assert(file && Object.keys(file).every(key => ["path", "beforeDigest", "contentBase64", "mode"].includes(key)), "invalid artifact file");
    pathName(file.path); assert(withinScope(file.path, scope) && !paths.has(file.path.toLowerCase()), "out-of-scope or duplicate artifact path"); paths.add(file.path.toLowerCase());
    assert(file.beforeDigest === null || /^sha256:[a-f0-9]{64}$/.test(file.beforeDigest), "invalid before digest");
    assert(file.mode === undefined || file.mode === 0o644 || file.mode === 0o755, "invalid file mode");
    assert(file.contentBase64 === null || typeof file.contentBase64 === "string", "invalid artifact bytes");
    if (file.contentBase64 !== null) { const content = Buffer.from(file.contentBase64, "base64"); assert(content.toString("base64") === file.contentBase64 && content.length <= MAX_ARTIFACT_FILE_BYTES, "invalid or excessive base64"); bytes += content.length; }
  }
  assert(bytes <= MAX_BYTES && artifact.digest === artifactDigest(artifact.files), "artifact digest or size mismatch");
}
function applyEntries(input: Entry[], artifacts: ManagedArtifact[], scope: string[]): Entry[] {
  const map = new Map(input.map(file => [file.path, { ...file }]));
  for (const artifact of artifacts) { validateArtifact(artifact, scope); for (const file of artifact.files) {
    const before = map.get(file.path); assert((before?.digest ?? null) === file.beforeDigest, `conflicting beforeimage: ${file.path}`);
    assert(before?.readonlySize === undefined, "read-only asset cannot be changed by artifacts");
    if (file.contentBase64 === null) { assert(before, "deletion of missing file"); map.delete(file.path); }
    else map.set(file.path, { path: file.path, digest: hash(Buffer.from(file.contentBase64, "base64")), mode: file.mode ?? before?.mode ?? 0o644, contentBase64: file.contentBase64 });
  } }
  const result = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  assert(new Set(result.map(file => file.path.toLowerCase())).size === result.length, "case-colliding artifact paths");
  for (const file of result) assert(!result.some(other => other.path.startsWith(`${file.path}/`)), "file/directory artifact collision");
  return result;
}
async function validateBase(base: ManagedBase) {
  scopes(base.scope); assert(base.root === resolve(base.root) && base.baselineDirectory === resolve(base.baselineDirectory), "invalid base paths");
  const marker = JSON.parse(await readFile(join(base.baselineDirectory, ".git", "forge-managed-base.json"), "utf8")) as ManagedBase;
  assert(stableStringify(marker) === stableStringify(base), "base identity mismatch");
  if (base.contextScope !== undefined) { assert(Array.isArray(base.contextScope) && base.contextScope.length <= 1000 && /^sha256:[a-f0-9]{64}$/.test(base.contextDigest ?? ""), "invalid context metadata"); for (const path of base.contextScope) pathName(path); }
  const baselineDigest = await readFile(join(base.baselineDirectory, ".git", "forge-managed-baseline-digest"), "utf8");
  assert((await workspaceInventory(base, base.baselineDirectory)).digest === baselineDigest && (await inventory(base.baselineDirectory, base.scope)).digest === base.digest, "immutable baseline modified");
}
export async function captureManagedBase(root: string, runId: string, scope: string[]): Promise<ManagedBase> {
  root = resolve(root); assert(typeof runId === "string" && runId.trim().length > 0, "runId required"); scope = scopes(scope);
  for (const path of scope) await safePath(root, path);
  const contextScope = await readonlyContextPaths(root, scope), head = await git(root, ["rev-parse", "HEAD"]), snapshot = await inventory(root, scope), context = await inventory(root, contextScope), capturedSource = await inventory(root, [...scope, ...contextScope]), baselineDirectory = await clone(root, "forge-managed-base-");
  await git(baselineDirectory, ["checkout", "--quiet", "--detach", head]);
  const tracked = await inventory(baselineDirectory, [...scope, ...contextScope]);
  const captured = new Map(capturedSource.files.map(file => [file.path, file])), prior = new Map(tracked.files.map(file => [file.path, file]));
  for (const file of tracked.files) if (!captured.has(file.path)) await setFile(baselineDirectory, { path: file.path, contentBase64: null });
  for (const file of capturedSource.files) if (prior.get(file.path)?.digest !== file.digest || prior.get(file.path)?.mode !== file.mode) await setFile(baselineDirectory, file);
  assert((await inventory(root, scope)).digest === snapshot.digest && (await inventory(root, contextScope)).digest === context.digest && await git(root, ["rev-parse", "HEAD"]) === head, "source changed during capture");
  const base: ManagedBase = { root, runId, head, scope, digest: snapshot.digest, baselineDirectory, ...(contextScope.length ? { contextScope, contextDigest: context.digest } : {}) };
  await writeFile(join(baselineDirectory, ".git", "forge-managed-base.json"), JSON.stringify(base));
  await writeFile(join(baselineDirectory, ".git", "forge-managed-baseline-digest"), (await workspaceInventory(base, baselineDirectory)).digest); return base;
}
export async function prepareManagedWorkspace(base: ManagedBase, attemptId: string, dependencies: ManagedArtifact[]): Promise<{ directory: string; inputDigest: string }> {
  await validateBase(base); assert(typeof attemptId === "string" && attemptId.trim().length > 0, "attemptId required");
  const baseline = await workspaceInventory(base, base.baselineDirectory), desired = applyEntries(baseline.files, dependencies, base.scope), directory = await clone(base.baselineDirectory, "forge-managed-attempt-");
  await git(directory, ["checkout", "--quiet", "--detach", base.head]);
  const initial = await workspaceInventory(base, directory);
  const desiredByPath = new Map(desired.map(file => [file.path, file])), initialByPath = new Map(initial.files.map(file => [file.path, file]));
  for (const file of initial.files) if (!desiredByPath.has(file.path)) await setFile(directory, { path: file.path, contentBase64: null });
  for (const file of desired) if (initialByPath.get(file.path)?.digest !== file.digest || initialByPath.get(file.path)?.mode !== file.mode) await setFile(directory, file);
  const input = await workspaceInventory(base, directory), metadata: WorkspaceMetadata = { baseDigest: base.digest, runId: base.runId, attemptId, directory, input };
  await writeFile(join(directory, ".git", "forge-managed-input.json"), JSON.stringify(metadata)); return { directory, inputDigest: input.digest };
}
export async function captureManagedArtifact(base: ManagedBase, workspaceDirectory: string, writeScope: string[], expectedInputDigest: string, environment?: ManagedEnvironment): Promise<ManagedArtifact> {
  await validateBase(base); assert(Array.isArray(writeScope), "write scope must be an array"); writeScope = writeScope.length ? scopes(writeScope) : []; assert(writeScope.every(path => withinScope(path, base.scope)), "write scope exceeds base");
  workspaceDirectory = resolve(workspaceDirectory);
  const metadata = JSON.parse(await readFile(join(workspaceDirectory, ".git", "forge-managed-input.json"), "utf8")) as WorkspaceMetadata;
  assert(metadata.directory === workspaceDirectory && metadata.baseDigest === base.digest && metadata.runId === base.runId, "workspace identity mismatch");
  assert(/^sha256:[a-f0-9]{64}$/.test(expectedInputDigest) && metadata.input.digest === expectedInputDigest && metadata.input.digest === inventoryDigest(metadata.input.files)
    && metadata.input.files.every(file => file.readonlySize === undefined ? typeof file.contentBase64 === "string" && hash(Buffer.from(file.contentBase64, "base64")) === file.digest
      : file.contentBase64 === undefined && Number.isSafeInteger(file.readonlySize) && file.readonlySize > MAX_SNAPSHOT_FILE_BYTES && file.readonlySize <= MAX_READONLY_ASSET_BYTES
        && !withinScope(file.path, [...base.scope, ...(base.contextScope ?? [])]) && /^sha256:[a-f0-9]{64}$/.test(file.digest)), "input inventory corrupted or coordinator digest mismatch");
  if (environment) { assert(environment.directory === workspaceDirectory, "environment belongs to another checkout"); await verifyManagedEnvironment(environment); assert(!metadata.input.files.some(file => environment.derivedPaths.some(path => file.path === path || file.path.startsWith(`${path}/`))), "derived environment would conceal captured source"); }
  const current = await workspaceInventory(base, workspaceDirectory, environment?.derivedPaths ?? []), prior = new Map(metadata.input.files.map(file => [file.path, file])), after = new Map(current.files.map(file => [file.path, file]));
  const files: ManagedFile[] = [];
  for (const path of [...new Set([...prior.keys(), ...after.keys()])].sort()) {
    const before = prior.get(path), next = after.get(path); if (before?.digest === next?.digest && before?.mode === next?.mode) continue;
    assert(withinScope(path, writeScope), `unauthorized change: ${path}`);
    files.push({ path, beforeDigest: before?.digest ?? null, contentBase64: next ? entryContent(next) : null, ...(next ? { mode: next.mode } : {}) });
  }
  const artifact = { digest: artifactDigest(files), files }; validateArtifact(artifact, writeScope); return artifact;
}
export async function publishManagedArtifacts(base: ManagedBase, artifacts: ManagedArtifact[]): Promise<{ digest: string; changedFiles: string[] }> {
  await validateBase(base); const before = await inventory(base.root, base.scope);
  assert(before.digest === base.digest && await currentContextMatches(base) && await git(base.root, ["rev-parse", "HEAD"]) === base.head, "source changed since capture (including readonly environment context)");
  const after = applyEntries(before.files, artifacts, base.scope), old = new Map(before.files.map(file => [file.path, file])), desired = new Map(after.map(file => [file.path, file]));
  const changedFiles = [...new Set([...old.keys(), ...desired.keys()])].filter(path => old.get(path)?.digest !== desired.get(path)?.digest || old.get(path)?.mode !== desired.get(path)?.mode).sort();
  for (const path of changedFiles) {
    const target = await safePath(base.root, path);
    try { assert((await lstat(target)).isFile(), "publish target is not a regular file"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const stageParent = await safePath(base.root, ".forge/local/agent-fabric/publication-staging");
  await mkdir(stageParent, { recursive: true }); await safePath(base.root, ".forge/local/agent-fabric/publication-staging");
  const stage = await mkdtemp(join(stageParent, "publication-"));
  for (let index = 0; index < changedFiles.length; index++) { const file = desired.get(changedFiles[index]); if (file) await writeFile(join(stage, `${index}`), Buffer.from(entryContent(file), "base64")); }
  assert((await inventory(base.root, base.scope)).digest === before.digest && await currentContextMatches(base), "source or context changed before publication");
  const applied: { path: string; writtenDigest: string | null; writtenMode: number | null }[] = [];
  try {
    for (let index = 0; index < changedFiles.length; index++) {
      const path = changedFiles[index], file = desired.get(path), target = await safePath(base.root, path);
      let currentDigest: string | null = null, currentMode: number | null = null;
      try { const stat = await lstat(target); assert(stat.isFile(), "publication target changed type"); currentDigest = hash(await readFile(target)); currentMode = stat.mode & 0o111 ? 0o755 : 0o644; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      assert(currentDigest === (old.get(path)?.digest ?? null) && currentMode === (old.get(path)?.mode ?? null), `concurrent publication edit: ${path}`);
      if (!file) { await setFile(base.root, { path, contentBase64: null }); applied.push({ path, writtenDigest: null, writtenMode: null }); }
      else {
        await mkdir(dirname(target), { recursive: true }); const staged = join(stage, `${index}`), stagedMode = (await lstat(staged)).mode & 0o111 ? 0o755 : 0o644;
        await rename(staged, target); const written = { path, writtenDigest: file.digest, writtenMode: stagedMode }; applied.push(written);
        await chmod(target, file.mode); written.writtenMode = file.mode;
      }
    }
  } catch (error) {
    const uncertain: string[] = [];
    for (const written of applied.reverse()) {
      try {
        const target = await safePath(base.root, written.path); let currentDigest: string | null = null, currentMode: number | null = null;
        try { const stat = await lstat(target); assert(stat.isFile(), "rollback target changed type"); currentDigest = hash(await readFile(target)); currentMode = stat.mode & 0o111 ? 0o755 : 0o644; }
        catch (readError) { if ((readError as NodeJS.ErrnoException).code !== "ENOENT") throw readError; }
        if (currentDigest !== written.writtenDigest || currentMode !== written.writtenMode) { uncertain.push(written.path); continue; }
        const file = old.get(written.path); await setFile(base.root, file ?? { path: written.path, contentBase64: null });
      } catch { uncertain.push(written.path); }
    }
    if (uncertain.length) throw new Error(`managed workspace: uncertain publication; external edits or rollback failure preserved at ${uncertain.join(", ")}; evidence retained at ${stage}`, { cause: error });
    throw error;
  }
  await rm(stage, { recursive: true }); return { digest: (await inventory(base.root, base.scope)).digest, changedFiles };
}

/** Compute publication outcome from captured source without changing the user's checkout. */
export async function previewManagedArtifacts(base: ManagedBase, artifacts: ManagedArtifact[]): Promise<{ digest: string; changedFiles: string[] }> {
  await validateBase(base); const before = await inventory(base.baselineDirectory, base.scope), after = applyEntries(before.files, artifacts, base.scope);
  const old = new Map(before.files.map(file => [file.path, file])), desired = new Map(after.map(file => [file.path, file]));
  return { digest: inventoryDigest(after), changedFiles: [...new Set([...old.keys(), ...desired.keys()])].filter(path => old.get(path)?.digest !== desired.get(path)?.digest || old.get(path)?.mode !== desired.get(path)?.mode).sort() };
}
/** Crash recovery confirms only a completely materialized publication. It never writes. */
export async function confirmManagedPublication(base: ManagedBase, artifacts: ManagedArtifact[]): Promise<boolean> {
  const expected = await previewManagedArtifacts(base, artifacts);
  return (await inventory(base.root, base.scope)).digest === expected.digest && await currentContextMatches(base) && await git(base.root, ["rev-parse", "HEAD"]) === base.head;
}
export async function confirmManagedBaseline(base: ManagedBase): Promise<boolean> {
  await validateBase(base); return (await inventory(base.root, base.scope)).digest === base.digest && await currentContextMatches(base) && await git(base.root, ["rev-parse", "HEAD"]) === base.head;
}
