import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DeltaStore } from "../../src/forge/delta/store.ts";
import { shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import { traceProjectionDigest, type TraceProjectionBatch } from "../../src/forge/delta/trace-projection.ts";

const cli = fileURLToPath(new URL("../../bin/forge.mjs", import.meta.url));
const runKey = { repositoryId: "cli-repository", checkoutId: "cli-checkout", fabricStoreId: "cli-store", runId: "cli-run" };
const generationId = "cli-generation";
const ref = (value: string) => `sha256:${traceProjectionDigest(value)}`;

function runCli(root: string, args: string[], expectedExit = 0): Record<string, unknown> {
  // Exercise the installed entrypoint with recording enabled, rather than invoking the handler
  // directly or relying on --no-delta/FORGE_DELTA=0 to hide post-command writes.
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  Object.assign(env, { FORGE_DELTA: "1", FORGE_DELTA_BACKGROUND_DRAIN: "0", FORGE_FABRIC_TEST_MODE: "1", FORGE_SMOKE_REAL: "0" });
  const result = spawnSync(process.env.FORGE_TRACE_NODE ?? "node", [cli, "trace", ...args, "--json"], {
    cwd: root, env, encoding: "utf8", timeout: 30000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  if (result.status !== expectedExit) throw new Error(`Trace CLI exited ${result.status}: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function request(root: string, value: unknown = { runKey }): string {
  const name = "trace-request.json";
  writeFileSync(join(root, name), JSON.stringify(value));
  return name;
}

function assertNoActivation(root: string): void {
  for (const path of [".forge/fabric-trace.json", ".forge/fabric-programs.json", ".forge/fabric.json", ".forge/agent", ".codex", ".mcp.json"]) {
    expect(existsSync(join(root, path))).toBe(false);
  }
}

function fileHashes(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  function visit(directory: string, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), relative);
      else result[relative] = createHash("sha256").update(readFileSync(join(directory, entry.name))).digest("hex");
    }
  }
  visit(root);
  return result;
}

async function populatedFixture(body: (root: string, store: DeltaStore) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "forge-trace-cli-populated-"));
  const priorDrain = process.env.FORGE_DELTA_BACKGROUND_DRAIN;
  process.env.FORGE_DELTA_BACKGROUND_DRAIN = "0";
  let store: DeltaStore | undefined;
  try {
    store = await DeltaStore.open(root, { access: "write" });
    await store.appendOperation({ kind: "fixture.preserved", summary: "existing user history", data: { fixture: true } });
    await store.traceCreateGeneration({ generationId, extractorVersion: "trace-v1" });
    const cut = { version: 1, journalRef: ref("journal-1"), stateRef: ref("state-1") };
    const batch: TraceProjectionBatch = {
      generationId, runKey, cut,
      facts: [{
        journalVersion: 1, journalRef: cut.journalRef, stateRef: cut.stateRef,
        factKind: "run-state", factIdentity: runKey.runId, sourceDigest: traceProjectionDigest("run-state"),
        entities: [{ id: runKey.runId, kind: "run", data: { observedStatus: "applied" } }],
      }],
    };
    await store.traceProjectBatch(batch);
    await store.traceActivateGeneration({ generationId, cuts: [{ runKey, cut }] });
    await body(root, store);
  } finally {
    await store?.close();
    await shutdownDeltaBroker(root);
    rmSync(root, { recursive: true, force: true });
    if (priorDrain === undefined) delete process.env.FORGE_DELTA_BACKGROUND_DRAIN;
    else process.env.FORGE_DELTA_BACKGROUND_DRAIN = priorDrain;
  }
}

async function seedGitEvidence(store: DeltaStore): Promise<void> {
  const cut = { version: 2, journalRef: ref("journal-2"), stateRef: ref("state-2") };
  await store.traceProjectBatch({
    generationId, runKey, cut, previous: { version: 1, journalRef: ref("journal-1"), stateRef: ref("state-1") },
    facts: [{
      journalVersion: 2, journalRef: cut.journalRef, stateRef: cut.stateRef,
      factKind: "git-observation", factIdentity: "cli-candidates", sourceDigest: traceProjectionDigest("cli-candidates"),
      entities: [
        { id: "candidate-A", kind: "candidate", data: { candidateId: "candidate-A", candidateDigest: ref("candidate-A"), paths: ["src/a.ts"] } },
        { id: "candidate-B", kind: "candidate", data: { candidateId: "candidate-B", candidateDigest: ref("candidate-B"), paths: ["src/b.ts"] } },
        { id: "annotation-A", kind: "annotation", data: { annotationRef: ref("annotation-A") } },
        // The extractor records the verification scope, which may be a directory, rather
        // than the candidate's changed files. File filtering must join through its digest.
        { id: "git-A", kind: "git-observation", data: { annotationRef: ref("annotation-A"), candidateDigest: ref("candidate-A"), paths: ["src"], observation: "observed", commitOid: "a".repeat(40), contentMatch: "matches" } },
        { id: "annotation-B", kind: "annotation", data: { annotationRef: ref("annotation-B") } },
        { id: "git-B", kind: "git-observation", data: { annotationRef: ref("annotation-B"), candidateDigest: ref("candidate-B"), paths: ["src"], observation: "unknown", commitOid: "b".repeat(40), contentMatch: "mismatch" } },
      ],
      relations: ["A", "B"].flatMap(id => [
        { from: `annotation-${id}`, to: `git-${id}`, predicate: "records", provenance: { capture: "host-reported", claimKind: "declared" as const, authority: "none" } },
        { from: `git-${id}`, to: `candidate-${id}`, predicate: "contains-candidate-content", provenance: { capture: "git-object-read", claimKind: "observed" as const, authority: "none" } },
      ]),
    }],
  });
}

async function seedCorrection(store: DeltaStore): Promise<void> {
  const cut = { version: 3, journalRef: ref("journal-3"), stateRef: ref("state-3") };
  await store.traceProjectBatch({
    generationId, runKey, cut, previous: { version: 2, journalRef: ref("journal-2"), stateRef: ref("state-2") },
    facts: [{
      journalVersion: 3, journalRef: cut.journalRef, stateRef: cut.stateRef,
      factKind: "annotation", factIdentity: "correction-A", sourceDigest: traceProjectionDigest("correction-A"),
      entities: [{ id: "correction-A", kind: "correction", data: {
        annotationRef: ref("correction-A"), supersedesRef: ref("annotation-A"), reason: "clarify fixture evidence",
        replacementSummary: "host declaration only", replacementProducer: "fixture-controller",
      } }],
      relations: [{ from: "correction-A", to: "annotation-A", predicate: "supersedes", provenance: { capture: "host-reported", claimKind: "declared", authority: "none" } }],
    }],
  });
}

test("real trace CLI absent status and explain never initialize a store, broker or owner", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-trace-cli-absent-"));
  try {
    const file = request(root);
    const before = fileHashes(root);
    expect(runCli(root, ["status"])).toMatchObject({ ok: true, result: { status: "unavailable" } });
    expect(runCli(root, ["explain", "--file", file])).toMatchObject({ ok: true, result: { projection: { status: "unavailable" } } });
    expect(fileHashes(root)).toEqual(before);
    expect(existsSync(join(root, ".forge"))).toBe(false);
    assertNoActivation(root);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 90000);

test("real trace CLI rejected explain remains read-only after the handler fails", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-trace-cli-invalid-"));
  try {
    const invalidRequests = [
      { runKey: { ...runKey, repositoryId: "/invalid/absolute/identity" } },
      ...["", false, 0, null].flatMap(value => [{ runKey, candidateId: value }, { runKey, path: value }]),
    ];
    for (const body of invalidRequests) {
      const file = request(root, body);
      const before = fileHashes(root);
      expect(runCli(root, ["explain", "--file", file], 1)).toMatchObject({ ok: false, code: "TRACE_INVALID_REFERENCE" });
      expect(fileHashes(root)).toEqual(before);
      expect(existsSync(join(root, ".forge"))).toBe(false);
      assertNoActivation(root);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120000);

test("real trace CLI reads the active fixture broker without adding recording or changing projection counts", async () => {
  await populatedFixture(async (root, store) => {
    const file = request(root);
    const before = {
      details: await store.statusDetails(), timeline: await store.timeline({}),
      projection: await store.traceStatus(), memory: await store.listAgentMemoryEvents(),
    };
    const endpointPath = join(root, ".forge/delta/broker-endpoint.json");
    const endpoint = readFileSync(endpointPath);
    expect(runCli(root, ["status"])).toMatchObject({ ok: true, result: { generationId, status: "active" } });
    expect(runCli(root, ["explain", "--file", file])).toMatchObject({ ok: true, result: { execution: { observedStatus: "applied" } } });
    expect({
      details: await store.statusDetails(), timeline: await store.timeline({}),
      projection: await store.traceStatus(), memory: await store.listAgentMemoryEvents(),
    }).toEqual(before);
    expect(readFileSync(endpointPath)).toEqual(endpoint);
    assertNoActivation(root);
  });
}, 120000);

test("real trace CLI with an offline existing database preserves every file and never restarts its broker", async () => {
  await populatedFixture(async (root, store) => {
    const file = request(root);
    await store.close();
    await shutdownDeltaBroker(root);
    const before = fileHashes(root);
    expect(existsSync(join(root, ".forge/delta/broker-endpoint.json"))).toBe(false);
    expect(runCli(root, ["status"])).toMatchObject({ ok: true, result: { status: "unavailable" } });
    expect(runCli(root, ["explain", "--file", file])).toMatchObject({ ok: true, result: { projection: { status: "unavailable" } } });
    expect(fileHashes(root)).toEqual(before);
    assertNoActivation(root);
  });
}, 120000);

test("real trace CLI candidate and path filters keep Git summaries inside their target", async () => {
  await populatedFixture(async (root, store) => {
    await seedGitEvidence(store);
    const before = { details: await store.statusDetails(), projection: await store.traceStatus() };
    for (const filter of [{ candidateId: "candidate-A" }, { path: "src/a.ts" }, { candidateId: "candidate-A", path: "src/a.ts" }]) {
      const file = request(root, { runKey, ...filter });
      const response = runCli(root, ["explain", "--file", file]);
      expect(response).toMatchObject({ ok: true, result: {
        projection: { graphScope: "target-at-cut" }, target: { match: "found-at-cut" },
        git: { observation: "observed", contentMatch: "matches", summaryScope: "target-at-cut" },
      } });
      expect(JSON.stringify(response)).toContain("a".repeat(40));
      expect(JSON.stringify(response)).not.toContain("b".repeat(40));
      expect(JSON.stringify(response)).not.toContain('"candidate-B"');
    }
    const sibling = runCli(root, ["explain", "--file", request(root, { runKey, path: "src/b.ts" })]);
    expect(sibling).toMatchObject({ result: { git: { observation: "unknown", contentMatch: "mismatch" } } });
    expect(JSON.stringify(sibling)).not.toContain("a".repeat(40));
    const mismatch = runCli(root, ["explain", "--file", request(root, { runKey, candidateId: "candidate-A", path: "src/b.ts" })]);
    expect(mismatch).toMatchObject({ result: { target: { match: "not-found" }, git: { observation: "not-observed", contentMatch: "not-evaluated", evidence: [] } } });
    const partial = runCli(root, ["explain", "--file", request(root, { runKey, candidateId: "candidate-A", limit: 1 })]);
    expect(partial).toMatchObject({ result: { projection: { status: "partial" }, git: { observation: "unknown", contentMatch: "not-evaluated" } } });
    expect({ details: await store.statusDetails(), projection: await store.traceStatus() }).toEqual(before);
    assertNoActivation(root);
  });
}, 180000);

test("real trace CLI explains corrections without granting authority or presenting superseded Git as current", async () => {
  await populatedFixture(async (root, store) => {
    await seedGitEvidence(store);
    await seedCorrection(store);
    const before = { details: await store.statusDetails(), projection: await store.traceStatus() };
    const filter = { runKey, candidateId: "candidate-A" };
    const current = runCli(root, ["explain", "--file", request(root, filter)]);
    expect(current).toMatchObject({ ok: true, result: {
      git: { observation: "unknown", contentMatch: "not-evaluated" },
      corrections: [{ annotationRef: ref("correction-A"), supersedesRef: ref("annotation-A"), reason: "clarify fixture evidence",
        replacement: { summary: "host declaration only", producer: "fixture-controller" }, claimKind: "declared", authority: "none", details: "available" }],
      gaps: expect.arrayContaining(["git-observation-superseded"]),
      entities: expect.arrayContaining([
        expect.objectContaining({ id: "annotation-A", data: expect.objectContaining({ superseded: true, supersededBy: [ref("correction-A")] }) }),
        expect.objectContaining({ id: "git-A", data: expect.objectContaining({ superseded: true, commitOid: "a".repeat(40) }) }),
      ]),
    } });
    expect(JSON.stringify(current)).not.toContain("b".repeat(40));
    const historical = runCli(root, ["explain", "--file", request(root, { ...filter, atVersion: 2 })]);
    expect(historical).toMatchObject({ result: { corrections: [], git: { observation: "observed", contentMatch: "matches" } } });
    expect({ details: await store.statusDetails(), projection: await store.traceStatus() }).toEqual(before);
    assertNoActivation(root);
  });
}, 120000);
