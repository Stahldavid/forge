import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync, inflateSync } from "node:zlib";
import { stableStringify } from "../../src/forge/agent-fabric/canonical.ts";
import { captureManagedBase, previewManagedArtifacts, type ManagedArtifact, type ManagedBase, type ManagedFile } from "../../src/forge/agent-fabric/managed-workspace.ts";
import { buildTraceGitCandidateManifest, captureTraceGitBaseline, isTraceGitBaselineObservation, isTraceGitObservation, observeTraceGit, traceGitManifestDigest, type TraceGitObserveInput } from "../../src/forge/agent-fabric/trace-git.ts";

const identity = { repositoryId: "fixture-repo", checkoutId: "fixture-checkout", fabricStoreId: "fixture-store" };
const h = (data: string | Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const owned: string[] = [];
afterEach(async () => { for (const directory of owned.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function fixture(objectFormat: "sha1" | "sha256" = "sha1") {
  const root = await mkdtemp(join(tmpdir(), "forge-trace-git-")); owned.push(root);
  const git = (...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", `--object-format=${objectFormat}`); git("config", "user.name", "Trace Fixture"); git("config", "user.email", "fixture@example.invalid"); git("config", "core.autocrlf", "false");
  await mkdir(join(root, "src")); await writeFile(join(root, "src/a.txt"), "before\n"); await writeFile(join(root, "src/remove.txt"), "remove\n"); await writeFile(join(root, "outside.txt"), "outside\n");
  git("add", "."); git("commit", "-qm", "baseline");
  return { root, git };
}
async function capture(root: string): Promise<ManagedBase> { const base = await captureManagedBase(root, "fixture-run", ["src"]); owned.push(dirname(base.baselineDirectory)); return base; }
function artifact(files: ManagedFile[]): ManagedArtifact { return { digest: h(stableStringify(files)), files }; }
function changedA(mode?: number): ManagedFile { return { path: "src/a.txt", beforeDigest: h("before\n"), contentBase64: Buffer.from("after\n").toString("base64"), ...(mode === undefined ? {} : { mode }) }; }
async function inputFor(root: string, base: ManagedBase, artifacts: ManagedArtifact[]): Promise<Omit<TraceGitObserveInput, "commitOid">> {
  const candidateDigest = (await previewManagedArtifacts(base, artifacts)).digest;
  return { root, identity, base, artifacts, candidateDigest, baselineObservation: await captureTraceGitBaseline({ root, identity, head: base.head, baselineDigest: base.digest }),
    applyReceipt: { status: "applied", candidateDigest, baselineDigest: base.digest, receiptRef: h("confirmed-fixture-receipt"), sourceJournalRef: h("committed-fixture-apply-journal") } };
}
async function apply(root: string, files: ManagedFile[]) {
  for (const file of files) { if (file.contentBase64 === null) await rm(join(root, file.path)); else { await writeFile(join(root, file.path), Buffer.from(file.contentBase64, "base64")); if (file.mode) await chmod(join(root, file.path), file.mode); } }
}

test("reads full Git objects and verifies complete bytes, deletion, addition and executable mode independently of host declaration", async () => {
  const { root, git } = await fixture(); const base = await capture(root);
  const files = [changedA(0o755), { path: "src/remove.txt", beforeDigest: h("remove\n"), contentBase64: null }, { path: "src/new.txt", beforeDigest: null, contentBase64: Buffer.from([0, 255, 127, 10]).toString("base64"), mode: 0o644 }];
  const input = await inputFor(root, base, [artifact(files)]); await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate");
  const commitOid = git("rev-parse", "HEAD"), indexBefore = await readFile(join(root, ".git/index"));
  const observed = await observeTraceGit({ ...input, commitOid });
  expect(observed.contentMatch).toBe("matches"); expect(observed.exactIntegration).toBe(true); expect(observed.commit.parents).toEqual([base.head]);
  expect(observed.claims).toEqual(["commit-observed", "contains-candidate-content"]); expect(observed.hostLink).toBe("not-reported"); expect(isTraceGitObservation(observed)).toBe(true);
  expect((await readFile(join(root, ".git/index"))).equals(indexBefore)).toBe(true);
  const declared = await observeTraceGit({ ...input, commitOid, hostLink: { capture: "host-reported", claimKind: "declared" } });
  expect(declared.hostLink).toBe("host-reported"); expect(declared.claims).toContain("commit-linked-by-host"); expect(isTraceGitObservation(declared)).toBe(true);
  const manifest = await buildTraceGitCandidateManifest(base, input.artifacts);
  expect(manifest.files).toContainEqual({ path: "src/remove.txt", type: "absent" }); expect(manifest.manifestDigest).toBe(traceGitManifestDigest(manifest.files));
  expect(manifest.manifestDigest).not.toBe(input.candidateDigest); expect(JSON.stringify(observed)).not.toContain(root);
});

test("supports SHA-256 Git object format without treating Fabric digests as OIDs", async () => {
  const { root, git } = await fixture("sha256"), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate");
  const observed = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") });
  expect(observed.objectFormat).toBe("sha256"); expect(observed.commit.oid?.length).toBe(64); expect(observed.exactIntegration).toBe(true);
  expect((await observeTraceGit({ ...input, commitOid: input.candidateDigest })).commit.status).toBe("not-observed");
});

test("requires a clean baseline, bound identity and confirmed apply separately from content equality", async () => {
  const { root, git } = await fixture(); await writeFile(join(root, "outside.txt"), "preexisting dirty\n"); git("add", "outside.txt");
  const base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  expect(input.baselineObservation?.index).toBe("dirty");
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate and preexisting change"); const commitOid = git("rev-parse", "HEAD");
  const observed = await observeTraceGit({ ...input, commitOid }); expect(observed.contentMatch).toBe("matches"); expect(observed.exactIntegration).toBe(false); expect(observed.reasons).toContain("clean-baseline-not-proven");
  const withoutApply = await observeTraceGit({ ...input, commitOid, applyReceipt: undefined, hostLink: { capture: "host-reported", claimKind: "declared" } }); expect(withoutApply.apply).toBeUndefined(); expect(withoutApply.reasons).toContain("confirmed-apply-required");
  expect(withoutApply.hostLink).toBe("not-reported"); expect(withoutApply.claims).not.toContain("commit-linked-by-host");
  const wrongIdentity = await observeTraceGit({ ...input, commitOid, baselineObservation: { ...input.baselineObservation!, checkoutId: "different-checkout", index: "clean", worktree: "clean" } });
  expect(wrongIdentity.exactIntegration).toBe(false);
});

test("dirty managed baseline stays content-match only even when final bytes match", async () => {
  const { root, git } = await fixture(); await writeFile(join(root, "src/a.txt"), "dirty baseline\n");
  const base = await capture(root), file = { ...changedA(), beforeDigest: h("dirty baseline\n") }, input = await inputFor(root, base, [artifact([file])]);
  expect(input.baselineObservation?.worktree).toBe("dirty"); await apply(root, [file]); git("add", "src"); git("commit", "-qm", "candidate");
  const observed = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") });
  expect(observed.contentMatch).toBe("matches"); expect(observed.exactIntegration).toBe(false); expect(observed.reasons).toContain("baseline-tree-differs");
});

test("partial index and extra-scope changes cannot qualify as exact candidate integration", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA(), { path: "src/remove.txt", beforeDigest: h("remove\n"), contentBase64: null }];
  const input = await inputFor(root, base, [artifact(files)]); await apply(root, files); git("add", "src/a.txt"); git("commit", "-qm", "partial");
  const partial = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD"), hostLink: { capture: "host-reported", claimKind: "declared" } });
  expect(partial.contentMatch).toBe("differs"); expect(partial.hostLink).toBe("not-reported"); expect(partial.exactIntegration).toBe(false); expect(partial.head.worktree).toBe("dirty");
  git("add", "src"); await writeFile(join(root, "outside.txt"), "extra\n"); git("add", "outside.txt"); git("commit", "--amend", "--no-edit", "-q");
  const extra = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") });
  expect(extra.contentMatch).toBe("matches"); expect(extra.exactIntegration).toBe(false); expect(extra.reasons).toContain("commit-delta-exceeds-candidate");
});

test("another parent and cherry-picked identical content never inherit exact integration or causal attribution", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "original"); const original = git("rev-parse", "HEAD");
  git("checkout", "-qb", "other-parent", base.head); await writeFile(join(root, "outside.txt"), "other-parent\n"); git("add", "outside.txt"); git("commit", "-qm", "different parent");
  git("cherry-pick", original); const observed = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") });
  expect(observed.contentMatch).toBe("matches"); expect(observed.exactIntegration).toBe(false); expect(observed.reasons).toContain("parent-does-not-match-baseline"); expect(observed.claims).not.toContain("commit-linked-by-host");
});

test("merge and squash with unrelated changes remain observed but limited", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  git("checkout", "-qb", "candidate"); await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate"); const candidate = git("rev-parse", "HEAD");
  git("checkout", "-qb", "other", base.head); await writeFile(join(root, "outside.txt"), "other\n"); git("add", "outside.txt"); git("commit", "-qm", "other");
  git("merge", "--no-ff", "-qm", "merge", candidate);
  const merged = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") }); expect(merged.commit.parents).toHaveLength(2); expect(merged.contentMatch).toBe("matches"); expect(merged.exactIntegration).toBe(false);
  git("checkout", "-qb", "squash", base.head); git("merge", "--squash", "other"); git("commit", "-qm", "squashed unrelated changes");
  const squashed = await observeTraceGit({ ...input, commitOid: git("rev-parse", "HEAD") }); expect(squashed.contentMatch).toBe("matches"); expect(squashed.exactIntegration).toBe(false); expect(squashed.reasons).toContain("commit-delta-exceeds-candidate");
});

test("missing objects, abbreviated OIDs and missing checkout are unknown rather than clean or committed", async () => {
  const { root } = await fixture(), base = await capture(root), input = await inputFor(root, base, [artifact([changedA()])]);
  const missing = await observeTraceGit({ ...input, commitOid: "1".repeat(40) }); expect(missing.commit.status).toBe("not-observed"); expect(missing.claims).toEqual([]);
  expect((await observeTraceGit({ ...input, commitOid: base.head.slice(0, 12) })).reasons).toContain("full-oid-required");
  const unknown = await captureTraceGitBaseline({ root: join(root, "does-not-exist"), identity, head: base.head, baselineDigest: base.digest }); expect(unknown.index).toBe("unknown"); expect(unknown.worktree).toBe("unknown");
  expect(isTraceGitObservation(missing)).toBe(true);
});

test("filters, LFS and CRLF are explicitly unsupported without executing transformations", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate"); const commitOid = git("rev-parse", "HEAD");
  git("config", "core.autocrlf", "true"); expect((await observeTraceGit({ ...input, commitOid })).contentMatch).toBe("unsupported"); git("config", "core.autocrlf", "false");
  await writeFile(join(root, ".gitattributes"), "src/* filter=fixture\n"); git("config", "filter.fixture.clean", "false");
  expect((await observeTraceGit({ ...input, commitOid })).contentMatch).toBe("unsupported"); await rm(join(root, ".gitattributes"));
  const crlf = artifact([{ ...changedA(), contentBase64: Buffer.from("after\r\n").toString("base64") }]);
  const crlfObserved = await observeTraceGit({ ...input, artifacts: [crlf], candidateDigest: (await previewManagedArtifacts(base, [crlf])).digest, commitOid }); expect(crlfObserved.contentMatch).toBe("unsupported");
  const lfs = artifact([{ ...changedA(), contentBase64: Buffer.from("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 3\n").toString("base64") }]);
  expect((await observeTraceGit({ ...input, artifacts: [lfs], candidateDigest: (await previewManagedArtifacts(base, [lfs])).digest, commitOid })).contentMatch).toBe("unsupported");
});

test("symlink commit and tampered artifacts fail closed and read errors never expose sensitive source text", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); await symlink("a.txt", join(root, "src/link")); git("add", "src"); git("commit", "-qm", "CANARY_SECRET_COMMIT_MESSAGE");
  const commitOid = git("rev-parse", "HEAD"), observed = await observeTraceGit({ ...input, commitOid }); expect(observed.contentMatch).toBe("unsupported");
  const tampered = structuredClone(input.artifacts); tampered[0].files[0].contentBase64 = Buffer.from("CANARY_RAW_SECRET_BYTES").toString("base64");
  const result = await observeTraceGit({ ...input, artifacts: tampered, commitOid }); expect(result.contentMatch).toBe("unverifiable");
  expect(JSON.stringify([result, observed])).not.toMatch(/CANARY|\/tmp\/|contentBase64|before\n/);
  const malicious = { ...observed, rawPath: "/CANARY_ABSOLUTE_PATH" }; expect(isTraceGitObservation(malicious)).toBe(false);
  expect(isTraceGitObservation({ ...observed, candidate: { ...observed.candidate, scope: ["../CANARY"] } })).toBe(false);
  expect(isTraceGitObservation({ ...observed, reasons: ["https://user:CANARY@host"] })).toBe(false);
});

test("a moving current index stays separate from the immutable commit evidence", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate"); const commitOid = git("rev-parse", "HEAD");
  await writeFile(join(root, "src/a.txt"), "future index\n"); git("add", "src/a.txt"); await writeFile(join(root, "src/a.txt"), "future worktree\n");
  const observed = await observeTraceGit({ ...input, commitOid }); expect(observed.head.index).toBe("dirty"); expect(observed.head.worktree).toBe("dirty"); expect(observed.contentMatch).toBe("matches"); expect(observed.exactIntegration).toBe(true);
});

test("refuses promisor repositories before object reads to prevent implicit remote fetch", async () => {
  const { root, git } = await fixture(), base = await capture(root), input = await inputFor(root, base, [artifact([changedA()])]);
  git("config", "remote.fixture.promisor", "true");
  const observed = await observeTraceGit({ ...input, commitOid: base.head });
  expect(observed.commit.status).toBe("unknown"); expect(observed.contentMatch).toBe("unsupported"); expect(observed.reasons).toContain("partial-clone-unsupported");
  expect(isTraceGitObservation(observed)).toBe(true);
});


test("baseline and commit reads never execute configured clean filters or alter index", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate"); const commitOid = git("rev-parse", "HEAD");
  const marker = join(root, ".git/filter-executed"), script = join(root, ".git/filter-fixture.cjs");
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed'); process.stdin.pipe(process.stdout);`);
  await writeFile(join(root, ".gitattributes"), "src/a.txt filter=fixture\n");
  git("config", "filter.fixture.clean", `node ${script}`);
  await writeFile(join(root, "src/a.txt"), "other\n"); await utimes(join(root, "src/a.txt"), 0, 0);
  const indexBefore = await readFile(join(root, ".git/index"));
  const baseline = await captureTraceGitBaseline({ root, identity, head: commitOid, baselineDigest: base.digest });
  expect(baseline.worktree).toBe("dirty");
  const observed = await observeTraceGit({ ...input, commitOid }); expect(observed.contentMatch).toBe("unsupported");
  await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await readFile(join(root, ".git/index"))).equals(indexBefore)).toBe(true);
});

test("verifies nested tree hashes and refuses corrupt tree bytes even with valid blob references", async () => {
  const { root, git } = await fixture(), base = await capture(root), files = [changedA()], input = await inputFor(root, base, [artifact(files)]);
  await apply(root, files); git("add", "src"); git("commit", "-qm", "candidate"); const commitOid = git("rev-parse", "HEAD"), treeOid = git("rev-parse", "HEAD:src");
  const objectPath = join(root, ".git/objects", treeOid.slice(0, 2), treeOid.slice(2));
  const original = inflateSync(await readFile(objectPath)), corrupted = Buffer.from(original), index = corrupted.indexOf(Buffer.from("a.txt")); expect(index).toBeGreaterThan(0);
  corrupted[index] = "b".charCodeAt(0); await chmod(objectPath, 0o644); await writeFile(objectPath, deflateSync(corrupted));
  const observed = await observeTraceGit({ ...input, commitOid });
  expect(observed.commit.status).toBe("observed"); expect(observed.contentMatch).toBe("unverifiable"); expect(observed.exactIntegration).toBe(false); expect(observed.reasons).toContain("object-integrity-failed");
  expect(observed.claims).not.toContain("contains-candidate-content");
});


test("baseline guard enforces full OID, digest domains, strict fields and unknown cleanliness", async () => {
  const { root } = await fixture(), base = await capture(root);
  const stamp = await captureTraceGitBaseline({ root, identity, head: base.head, baselineDigest: base.digest });
  expect(isTraceGitBaselineObservation(stamp)).toBe(true);
  expect(isTraceGitBaselineObservation({ ...stamp, objectFormat: "unknown", head: "", index: "unknown", worktree: "unknown" })).toBe(true);
  expect(isTraceGitBaselineObservation({ ...stamp, head: stamp.head.slice(0, 7) })).toBe(false);
  expect(isTraceGitBaselineObservation({ ...stamp, head: "", index: "clean" })).toBe(false);
  expect(isTraceGitBaselineObservation({ ...stamp, objectFormat: "unknown" })).toBe(false);
  expect(isTraceGitBaselineObservation({ ...stamp, baselineDigest: stamp.head })).toBe(false);
  expect(isTraceGitBaselineObservation({ ...stamp, root: "/CANARY_ABSOLUTE_ROOT" })).toBe(false);
});
