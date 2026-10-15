import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { stableStringify } from "./canonical.ts";
import { previewManagedArtifacts, type ManagedArtifact, type ManagedBase } from "./managed-workspace.ts";

export interface TraceGitIdentity { repositoryId: string; checkoutId: string; fabricStoreId: string }
type Cleanliness = "clean" | "dirty" | "unknown";
type ObjectFormat = "sha1" | "sha256" | "unknown";
export interface TraceGitBaselineObservation extends TraceGitIdentity {
  schema: "forge.trace-git-baseline.v1"; objectFormat: ObjectFormat; head: string;
  baselineDigest: string; index: Cleanliness; worktree: Cleanliness;
}
export interface TraceGitObservation extends TraceGitIdentity {
  schema: "forge.trace-git-observation.v1"; objectFormat: ObjectFormat;
  commit: { status: "observed" | "not-observed" | "unknown"; oid?: string; parents?: string[] };
  head: { oid?: string; index: Cleanliness; worktree: Cleanliness };
  candidate: { digest: string; baselineDigest: string; scope: string[]; manifestDigest?: string };
  contentMatch: "matches" | "differs" | "unverifiable" | "unsupported" | "not-evaluated";
  exactIntegration: boolean; hostLink: "not-reported" | "host-reported";
  claims: ("commit-observed" | "contains-candidate-content" | "commit-linked-by-host")[];
  apply?: { receiptRef: string; sourceJournalRef: string }; reasons: string[];
}
export interface TraceGitManifestEntry { path: string; type: "file" | "absent"; mode?: "100644" | "100755"; digest?: string }
export interface TraceGitObserveInput {
  root: string; identity: TraceGitIdentity; commitOid: string; base: ManagedBase;
  artifacts: ManagedArtifact[]; candidateDigest: string; baselineObservation?: TraceGitBaselineObservation;
  /** Trusted caller resolves this receipt and ancestor journal from the committed run. This API does not authenticate a plain object. */
  applyReceipt?: { status: "applied"; candidateDigest: string; baselineDigest: string; sourceJournalRef: string; receiptRef: string };
  hostLink?: { claimKind: "declared"; capture: "host-reported" };
}
const DIGEST = /^sha256:[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const digest = (bytes: string | Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const scoped = (path: string, scope: string[]) => scope.some(item => path === item || path.startsWith(`${item}/`));
function safeRelative(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && path.length <= 4096 && !isAbsolute(path) && !/[\\:\x00-\x1f\x7f]/.test(path)
    && path.split("/").every(part => part && part !== "." && part !== ".." && part.toLowerCase() !== ".git");
}
function validIdentity(identity: TraceGitIdentity): boolean { return Object.values(identity).length === 3 && [identity.repositoryId, identity.checkoutId, identity.fabricStoreId].every(value => typeof value === "string" && ID.test(value)); }
function sameIdentity(a: TraceGitIdentity, b: TraceGitIdentity): boolean { return a.repositoryId === b.repositoryId && a.checkoutId === b.checkoutId && a.fabricStoreId === b.fabricStoreId; }
function oidValid(oid: unknown, format: ObjectFormat): oid is string { return typeof oid === "string" && new RegExp(`^[a-f0-9]{${format === "sha256" ? 64 : 40}}$`).test(oid) && format !== "unknown"; }
class GitReadFailure extends Error { constructor(readonly reason: string, readonly exitCode?: number) { super(reason); } }
const fail = (reason: string): never => { throw new GitReadFailure(reason); };
/** Every invocation is a bounded read. Disable fsmonitor, optional index refresh, replace objects and external diff. */
function git(root: string, args: string[], input?: string): Promise<Buffer> {
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key];
  Object.assign(env, { GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1", LC_ALL: "C" });
  return new Promise((accept, reject) => {
    const child = execFile("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-C", root, ...args],
      { encoding: "buffer", maxBuffer: 16 * 1024 * 1024, timeout: 15_000, env, windowsHide: true }, (error, stdout) => error ? reject(new GitReadFailure("git-read-unavailable", typeof error.code === "number" ? error.code : undefined)) : accept(stdout));
    child.stdin?.end(input);
  });
}
async function text(root: string, args: string[]) { return (await git(root, args)).toString("utf8").trim(); }
async function assertRoot(root: string) {
  if (resolve(root) !== await realpath(root) || await realpath(await text(root, ["rev-parse", "--show-toplevel"])) !== resolve(root)) fail("checkout-identity-mismatch");
}
async function assertLocalObjects(root: string) {
  // Older Git versions may ignore GIT_NO_LAZY_FETCH. Refuse promisor repositories
  // before any object read instead of allowing cat-file to contact a remote.
  try {
    const config = await text(root, ["config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"]);
    if (config.split("\n").some(line => { const value = line.slice(line.indexOf(" ") + 1).trim(); return value !== "false" && value !== "0"; })) fail("partial-clone-unsupported");
  } catch (error) { if (!(error instanceof GitReadFailure) || error.exitCode !== 1) throw error; }
}
async function format(root: string): Promise<ObjectFormat> { const value = await text(root, ["rev-parse", "--show-object-format"]); return value === "sha1" || value === "sha256" ? value : fail("object-format-unsupported"); }
async function head(root: string): Promise<TraceGitObservation["head"]> {
  try {
    const objectFormat = await format(root), before = await text(root, ["rev-parse", "--verify", "HEAD"]);
    if (!oidValid(before, objectFormat)) fail("object-integrity-failed");
    // status/diff may execute clean filters while refreshing the index. Inspect
    // index object IDs and raw filesystem bytes directly, never invoking filters.
    const indexBytes = await git(root, ["ls-files", "--stage", "-z"]), decoded = indexBytes.toString("utf8");
    if (!Buffer.from(decoded, "utf8").equals(indexBytes)) fail("tree-path-or-bound-unsupported");
    const indexEntries: TreeEntry[] = []; let conflict = false;
    for (const row of decoded.split("\0").filter(Boolean)) {
      const tab = row.indexOf("\t"), [mode, oid, stage] = row.slice(0, tab).split(" "), path = row.slice(tab + 1);
      if (tab < 0 || !safeRelative(path) || !oidValid(oid, objectFormat) || indexEntries.length >= 20_000) fail("tree-path-or-bound-unsupported");
      if (stage !== "0") conflict = true;
      indexEntries.push({ path, mode, type: mode === "160000" ? "commit" : "blob", oid });
    }
    const committed = await tree(root, before, objectFormat);
    let index: Cleanliness = conflict || stableStringify(indexEntries.sort((a, b) => a.path.localeCompare(b.path))) !== stableStringify(committed.sort((a, b) => a.path.localeCompare(b.path))) ? "dirty" : "clean";
    let worktree: Cleanliness = "clean", total = 0;
    for (const entry of indexEntries) {
      if (!["100644", "100755"].includes(entry.mode)) { worktree = "unknown"; continue; }
      let path = resolve(root), stat;
      try {
        for (const part of entry.path.split("/")) { path = join(path, part); stat = await lstat(path); if (stat.isSymbolicLink()) fail("file-type-unsupported"); }
        if (!stat?.isFile()) { worktree = "dirty"; continue; }
        if (stat.size > 16 * 1024 * 1024) fail("manifest-bound-exceeded");
        const content = await readFile(path); total += content.length; if (total > 128 * 1024 * 1024) fail("manifest-bound-exceeded");
        const after = await lstat(path);
        if (after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail("git-read-unavailable");
        if (createHash(objectFormat).update(`blob ${content.length}\0`).update(content).digest("hex") !== entry.oid || (stat.mode & 0o111 ? "100755" : "100644") !== entry.mode) worktree = "dirty";
      } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") worktree = "dirty"; else throw error; }
    }
    if ((await git(root, ["ls-files", "--others", "--exclude-standard", "-z"])).length) worktree = "dirty";
    // A changing index/HEAD invalidates the combined observation.
    if (await text(root, ["rev-parse", "--verify", "HEAD"]) !== before || !(await git(root, ["ls-files", "--stage", "-z"])).equals(indexBytes)) return { index: "unknown", worktree: "unknown" };
    return { oid: before, index, worktree };
  } catch { return { index: "unknown", worktree: "unknown" }; }
}
export async function captureTraceGitBaseline(input: { root: string; identity: TraceGitIdentity; head: string; baselineDigest: string }): Promise<TraceGitBaselineObservation> {
  if (!validIdentity(input.identity) || !DIGEST.test(input.baselineDigest)) throw new Error("TRACE_GIT_INVALID_CONTEXT");
  let objectFormat: ObjectFormat = "unknown", observed: TraceGitObservation["head"] = { index: "unknown", worktree: "unknown" };
  try { await assertRoot(input.root); objectFormat = await format(input.root); await assertLocalObjects(input.root); observed = await head(input.root); } catch { /* Unknown is never clean. */ }
  const matches = observed.oid === input.head && oidValid(input.head, objectFormat);
  return { schema: "forge.trace-git-baseline.v1", ...input.identity, objectFormat, head: oidValid(input.head, objectFormat) ? input.head : "", baselineDigest: input.baselineDigest,
    index: matches ? observed.index : "unknown", worktree: matches ? observed.worktree : "unknown" };
}
interface Entry { path: string; digest: string; mode: number }
async function baselineFiles(base: ManagedBase): Promise<Entry[]> {
  if (resolve(base.baselineDirectory) !== await realpath(base.baselineDirectory)) fail("baseline-unsupported");
  const entries: Entry[] = []; let bytes = 0;
  const visit = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      if (!prefix && name === ".git") continue; const path = prefix ? `${prefix}/${name}` : name;
      if (!scoped(path, base.scope) && !base.scope.some(item => item.startsWith(`${path}/`))) continue;
      if (!safeRelative(path)) fail("path-unsupported"); const stat = await lstat(join(directory, name));
      if (stat.isSymbolicLink()) fail("file-type-unsupported");
      if (stat.isDirectory()) await visit(join(directory, name), path);
      else {
        if (!stat.isFile() || stat.size > 16 * 1024 * 1024 || entries.length >= 20_000) fail("file-type-or-bound-unsupported");
        const content = await readFile(join(directory, name)); bytes += content.length; if (bytes > 128 * 1024 * 1024) fail("manifest-bound-exceeded");
        if (content.includes(Buffer.from("\r\n")) || content.subarray(0, 128).toString().startsWith("version https://git-lfs.github.com/spec/v1")) fail("byte-conversion-unsupported");
        entries.push({ path, digest: digest(content), mode: stat.mode & 0o111 ? 0o755 : 0o644 });
      }
    }
  };
  await visit(base.baselineDirectory, ""); return entries.sort((a, b) => a.path.localeCompare(b.path));
}
/** Domain-separated metadata digest; never a Git tree OID or the Fabric candidate digest. */
export function traceGitManifestDigest(files: TraceGitManifestEntry[]): string { return digest(stableStringify({ schema: "forge.trace-git-manifest.v1", files })); }
async function deriveCandidate(base: ManagedBase, artifacts: ManagedArtifact[]) {
  const preview = await previewManagedArtifacts(base, artifacts), baseline = await baselineFiles(base);
  if (digest(JSON.stringify(baseline)) !== base.digest) fail("baseline-manifest-mismatch");
  const desired = new Map(baseline.map(file => [file.path, { ...file }])); const removed = new Set<string>();
  for (const artifact of artifacts) for (const file of artifact.files) {
    if (file.contentBase64 === null) { desired.delete(file.path); removed.add(file.path); }
    else {
      const bytes = Buffer.from(file.contentBase64, "base64");
      if (bytes.includes(Buffer.from("\r\n")) || bytes.subarray(0, 128).toString().startsWith("version https://git-lfs.github.com/spec/v1")) fail("byte-conversion-unsupported");
      desired.set(file.path, { path: file.path, digest: digest(bytes), mode: file.mode ?? desired.get(file.path)?.mode ?? 0o644 }); removed.delete(file.path);
    }
  }
  const files: TraceGitManifestEntry[] = [...desired.values()].map(file => ({ path: file.path, type: "file", mode: file.mode === 0o755 ? "100755" : "100644", digest: file.digest }));
  for (const path of removed) files.push({ path, type: "absent" }); files.sort((a, b) => a.path.localeCompare(b.path));
  // Revalidate after materializing metadata; a moving baseline cannot qualify.
  if ((await previewManagedArtifacts(base, artifacts)).digest !== preview.digest) fail("baseline-manifest-mismatch");
  return { files, baseline, preview, manifestDigest: traceGitManifestDigest(files) };
}
export async function buildTraceGitCandidateManifest(base: ManagedBase, artifacts: ManagedArtifact[]) {
  try { const value = await deriveCandidate(base, artifacts); return { files: value.files, manifestDigest: value.manifestDigest, candidateDigest: value.preview.digest, changedPaths: value.preview.changedFiles }; }
  catch (error) { throw new Error(error instanceof GitReadFailure ? error.reason : "TRACE_GIT_CANDIDATE_UNVERIFIABLE"); }
}
interface TreeEntry { path: string; mode: string; type: string; oid: string }
async function verifiedObject(root: string, type: "commit" | "tree", oid: string, objectFormat: ObjectFormat): Promise<Buffer> {
  if (!oidValid(oid, objectFormat)) fail("object-integrity-failed");
  const bytes = await git(root, ["cat-file", type, oid]);
  if (createHash(objectFormat).update(`${type} ${bytes.length}\0`).update(bytes).digest("hex") !== oid) fail("object-integrity-failed");
  return bytes;
}
async function tree(root: string, oid: string, objectFormat: ObjectFormat): Promise<TreeEntry[]> {
  const commit = await verifiedObject(root, "commit", oid, objectFormat), header = commit.toString("utf8").split("\n\n", 1)[0].split("\n");
  const treeHeader = header.filter(line => line.startsWith("tree ")); if (treeHeader.length !== 1) fail("object-integrity-failed");
  const result: TreeEntry[] = [], rawOidLength = objectFormat === "sha256" ? 32 : 20; let treeBytes = 0;
  const visit = async (treeOid: string, prefix: string, depth: number) => {
    if (depth > 128) fail("manifest-bound-exceeded");
    const bytes = await verifiedObject(root, "tree", treeOid, objectFormat); treeBytes += bytes.length; if (treeBytes > 16 * 1024 * 1024) fail("manifest-bound-exceeded");
    const names = new Set<string>(); let offset = 0;
    while (offset < bytes.length) {
      const space = bytes.indexOf(32, offset), nul = bytes.indexOf(0, space + 1);
      if (space <= offset || nul < 0 || nul + 1 + rawOidLength > bytes.length) fail("object-integrity-failed");
      const mode = bytes.subarray(offset, space).toString("ascii"), nameBytes = bytes.subarray(space + 1, nul), name = nameBytes.toString("utf8"), path = prefix ? `${prefix}/${name}` : name;
      if (!Buffer.from(name, "utf8").equals(nameBytes) || name.includes("/") || !safeRelative(path) || names.has(name)) fail("tree-path-or-bound-unsupported"); names.add(name);
      const childOid = bytes.subarray(nul + 1, nul + 1 + rawOidLength).toString("hex"); offset = nul + 1 + rawOidLength;
      if (mode === "40000") await visit(childOid, path, depth + 1);
      else {
        if (!["100644", "100755", "120000", "160000"].includes(mode)) fail("file-type-unsupported");
        if (result.length >= 20_000) fail("manifest-bound-exceeded"); result.push({ path, mode, type: mode === "160000" ? "commit" : "blob", oid: childOid });
      }
    }
  };
  await visit(treeHeader[0].slice(5), "", 0); return result;
}
async function manifest(root: string, entries: TreeEntry[], scope: string[], objectFormat: ObjectFormat): Promise<TraceGitManifestEntry[]> {
  let total = 0; const files: TraceGitManifestEntry[] = [];
  for (const entry of entries.filter(file => scoped(file.path, scope))) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode)) fail("file-type-unsupported");
    const bytes = await git(root, ["cat-file", "blob", entry.oid]); total += bytes.length;
    if (total > 128 * 1024 * 1024) fail("manifest-bound-exceeded");
    if (!oidValid(entry.oid, objectFormat) || createHash(objectFormat).update(`blob ${bytes.length}\0`).update(bytes).digest("hex") !== entry.oid) fail("object-integrity-failed");
    if (bytes.includes(Buffer.from("\r\n")) || bytes.subarray(0, 128).toString().startsWith("version https://git-lfs.github.com/spec/v1")) fail("byte-conversion-unsupported");
    files.push({ path: entry.path, type: "file", mode: entry.mode as "100644" | "100755", digest: digest(bytes) });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
function present(files: TraceGitManifestEntry[]) { return files.filter(file => file.type === "file"); }
async function conversionUnsupported(root: string, trees: TreeEntry[][], paths: string[]): Promise<boolean> {
  if (trees.some(entries => entries.some(file => file.path.split("/").at(-1) === ".gitattributes"))) return true;
  try { const config = await text(root, ["config", "--get", "core.autocrlf"]); if (config !== "false") return true; } catch (error) { if (!(error instanceof GitReadFailure) || error.exitCode !== 1) throw error; /* Unset is false. */ }
  try { if (await text(root, ["config", "--get", "core.attributesfile"])) return true; } catch (error) { if (!(error instanceof GitReadFailure) || error.exitCode !== 1) throw error; /* Unset. */ }
  if (paths.length && (await git(root, ["check-attr", "--all", "-z", "--stdin"], `${paths.join("\0")}\0`)).length) return true;
  return false;
}
export async function observeTraceGit(input: TraceGitObserveInput): Promise<TraceGitObservation> {
  if (!validIdentity(input.identity) || !DIGEST.test(input.candidateDigest) || !DIGEST.test(input.base.digest)
      || !Array.isArray(input.base.scope) || !input.base.scope.length || !input.base.scope.every(safeRelative)) throw new Error("TRACE_GIT_INVALID_CONTEXT");
  const output: TraceGitObservation = { schema: "forge.trace-git-observation.v1", ...input.identity, objectFormat: "unknown", commit: { status: "unknown" },
    head: { index: "unknown", worktree: "unknown" }, candidate: { digest: input.candidateDigest, baselineDigest: input.base.digest, scope: [...input.base.scope] },
    contentMatch: "not-evaluated", exactIntegration: false, hostLink: "not-reported", claims: [], reasons: [] };
  try {
    await assertRoot(input.root); if (resolve(input.root) !== resolve(input.base.root)) fail("checkout-identity-mismatch");
    output.objectFormat = await format(input.root); await assertLocalObjects(input.root); output.head = await head(input.root);
    if (!oidValid(input.commitOid, output.objectFormat)) { output.commit = { status: "not-observed" }; output.reasons.push("full-oid-required"); return output; }
    let bytes: Buffer;
    try { bytes = await git(input.root, ["cat-file", "commit", input.commitOid]); }
    catch { output.commit = { status: "not-observed", oid: input.commitOid }; output.reasons.push("commit-object-unavailable"); return output; }
    if (createHash(output.objectFormat).update(`commit ${bytes.length}\0`).update(bytes).digest("hex") !== input.commitOid) fail("object-integrity-failed");
    const parents = bytes.toString("utf8").split("\n\n", 1)[0].split("\n").filter(line => line.startsWith("parent ")).map(line => line.slice(7));
    if (!parents.every(parent => oidValid(parent, output.objectFormat))) fail("object-integrity-failed");
    output.commit = { status: "observed", oid: input.commitOid, parents }; output.claims.push("commit-observed");
    const candidate = await deriveCandidate(input.base, input.artifacts);
    if (candidate.preview.digest !== input.candidateDigest) fail("candidate-digest-mismatch"); output.candidate.manifestDigest = candidate.manifestDigest;
    const committedTree = await tree(input.root, input.commitOid, output.objectFormat), parentTree = oidValid(input.base.head, output.objectFormat) ? await tree(input.root, input.base.head, output.objectFormat) : [];
    if (await conversionUnsupported(input.root, [committedTree, parentTree], candidate.files.map(file => file.path))) fail("byte-conversion-unsupported");
    const committedFiles = await manifest(input.root, committedTree, input.base.scope, output.objectFormat);
    const matches = stableStringify(committedFiles) === stableStringify(present(candidate.files)); output.contentMatch = matches ? "matches" : "differs";
    if (!matches) { output.reasons.push("scoped-content-differs"); return output; }
    output.claims.push("contains-candidate-content");
    const receipt = input.applyReceipt;
    const applied = receipt?.status === "applied" && receipt.candidateDigest === input.candidateDigest && receipt.baselineDigest === input.base.digest && DIGEST.test(receipt.sourceJournalRef) && DIGEST.test(receipt.receiptRef);
    if (applied) {
      output.apply = { receiptRef: receipt.receiptRef, sourceJournalRef: receipt.sourceJournalRef };
      if (input.hostLink?.claimKind === "declared" && input.hostLink.capture === "host-reported") { output.hostLink = "host-reported"; output.claims.push("commit-linked-by-host"); }
    }
    else output.reasons.push("confirmed-apply-required");
    const baseline = input.baselineObservation;
    const clean = baseline?.schema === "forge.trace-git-baseline.v1" && sameIdentity(baseline, input.identity) && baseline.head === input.base.head && baseline.baselineDigest === input.base.digest
      && baseline.objectFormat === output.objectFormat && baseline.index === "clean" && baseline.worktree === "clean";
    if (!clean) output.reasons.push("clean-baseline-not-proven");
    const parentMatches = parents.length === 1 && parents[0] === input.base.head;
    if (!parentMatches) output.reasons.push(parents.length > 1 ? "merge-integration-unsupported" : "parent-does-not-match-baseline");
    const baselineManifest = candidate.baseline.map(file => ({ path: file.path, type: "file", mode: file.mode === 0o755 ? "100755" : "100644", digest: file.digest }));
    const baselineMatches = stableStringify(await manifest(input.root, parentTree, input.base.scope, output.objectFormat)) === stableStringify(baselineManifest);
    if (!baselineMatches) output.reasons.push("baseline-tree-differs");
    let fullDelta = false;
    if (parentMatches) {
      const before = new Map(parentTree.map(entry => [entry.path, entry])), after = new Map(committedTree.map(entry => [entry.path, entry]));
      const paths = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path)?.oid !== after.get(path)?.oid || before.get(path)?.mode !== after.get(path)?.mode).sort();
      fullDelta = stableStringify(paths) === stableStringify([...candidate.preview.changedFiles].sort());
      if (!fullDelta) output.reasons.push("commit-delta-exceeds-candidate");
    }
    output.exactIntegration = !!(applied && clean && parentMatches && baselineMatches && fullDelta);
    return output;
  } catch (error) {
    const reason = error instanceof GitReadFailure ? error.reason : "candidate-or-source-unverifiable";
    if (output.contentMatch !== "matches") output.contentMatch = reason.includes("unsupported") ? "unsupported" : "unverifiable"; output.exactIntegration = false; output.reasons.push(reason); return output;
  }
}
const REASONS = new Set(["checkout-identity-mismatch", "object-format-unsupported", "partial-clone-unsupported", "full-oid-required", "commit-object-unavailable", "object-integrity-failed", "baseline-unsupported", "path-unsupported", "file-type-unsupported", "file-type-or-bound-unsupported", "manifest-bound-exceeded", "byte-conversion-unsupported", "baseline-manifest-mismatch", "tree-path-or-bound-unsupported", "candidate-digest-mismatch", "scoped-content-differs", "confirmed-apply-required", "clean-baseline-not-proven", "merge-integration-unsupported", "parent-does-not-match-baseline", "baseline-tree-differs", "commit-delta-exceeds-candidate", "git-read-unavailable", "candidate-or-source-unverifiable"]);
function record(value: unknown, allowed: string[]): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)); }
/** Shape and domain validation only; trust still comes from the owner's pre-capture observer. */
export function isTraceGitBaselineObservation(value: unknown): value is TraceGitBaselineObservation {
  if (!record(value, ["schema", "repositoryId", "checkoutId", "fabricStoreId", "objectFormat", "head", "baselineDigest", "index", "worktree"])) return false;
  const v = value as unknown as TraceGitBaselineObservation;
  if (v.schema !== "forge.trace-git-baseline.v1" || !validIdentity({ repositoryId: v.repositoryId, checkoutId: v.checkoutId, fabricStoreId: v.fabricStoreId })
      || !["sha1", "sha256", "unknown"].includes(v.objectFormat) || !DIGEST.test(v.baselineDigest)
      || !["clean", "dirty", "unknown"].includes(v.index) || !["clean", "dirty", "unknown"].includes(v.worktree)) return false;
  if (v.objectFormat === "unknown" || v.head === "") return v.head === "" && v.index === "unknown" && v.worktree === "unknown";
  return oidValid(v.head, v.objectFormat);
}
export function isTraceGitObservation(value: unknown): value is TraceGitObservation {
  if (!record(value, ["schema", "repositoryId", "checkoutId", "fabricStoreId", "objectFormat", "commit", "head", "candidate", "contentMatch", "exactIntegration", "hostLink", "claims", "apply", "reasons"])) return false;
  const v = value as unknown as TraceGitObservation;
  if (v.schema !== "forge.trace-git-observation.v1" || !validIdentity({ repositoryId: v.repositoryId, checkoutId: v.checkoutId, fabricStoreId: v.fabricStoreId }) || !["sha1", "sha256", "unknown"].includes(v.objectFormat)) return false;
  if (!record(v.commit, ["status", "oid", "parents"]) || !["observed", "not-observed", "unknown"].includes(v.commit.status) || (v.commit.oid !== undefined && !oidValid(v.commit.oid, v.objectFormat))) return false;
  if (v.commit.parents !== undefined && (!Array.isArray(v.commit.parents) || v.commit.parents.length > 32 || !v.commit.parents.every(oid => oidValid(oid, v.objectFormat)))) return false;
  if (!record(v.head, ["oid", "index", "worktree"]) || !["clean", "dirty", "unknown"].includes(v.head.index) || !["clean", "dirty", "unknown"].includes(v.head.worktree) || (v.head.oid !== undefined && !oidValid(v.head.oid, v.objectFormat))) return false;
  if (!record(v.candidate, ["digest", "baselineDigest", "scope", "manifestDigest"]) || !DIGEST.test(v.candidate.digest) || !DIGEST.test(v.candidate.baselineDigest) || !Array.isArray(v.candidate.scope) || !v.candidate.scope.length || v.candidate.scope.length > 1000 || !v.candidate.scope.every(safeRelative) || (v.candidate.manifestDigest !== undefined && !DIGEST.test(v.candidate.manifestDigest))) return false;
  if (!["matches", "differs", "unverifiable", "unsupported", "not-evaluated"].includes(v.contentMatch) || typeof v.exactIntegration !== "boolean" || !["not-reported", "host-reported"].includes(v.hostLink)) return false;
  if (!Array.isArray(v.claims) || v.claims.some(claim => !["commit-observed", "contains-candidate-content", "commit-linked-by-host"].includes(claim)) || new Set(v.claims).size !== v.claims.length) return false;
  if (!Array.isArray(v.reasons) || v.reasons.length > 32 || !v.reasons.every(reason => typeof reason === "string" && REASONS.has(reason))) return false;
  if (v.apply !== undefined && (!record(v.apply, ["receiptRef", "sourceJournalRef"]) || !DIGEST.test(v.apply.receiptRef) || !DIGEST.test(v.apply.sourceJournalRef))) return false;
  if ((v.commit.status === "observed") !== v.claims.includes("commit-observed") || (v.commit.status === "observed" && (!v.commit.oid || !v.commit.parents))) return false;
  if ((v.contentMatch === "matches") !== v.claims.includes("contains-candidate-content") || (v.contentMatch === "matches" && v.commit.status !== "observed")) return false;
  if ((v.hostLink === "host-reported") !== v.claims.includes("commit-linked-by-host") || (v.hostLink === "host-reported" && (v.contentMatch !== "matches" || !v.apply))) return false;
  return !v.exactIntegration || (v.contentMatch === "matches" && !!v.apply && v.commit.parents?.length === 1);
}
