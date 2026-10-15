import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createTraceFixture } from "../agent-fabric/trace-fixture.ts";
import { projectFabricTrace } from "../../src/forge/agent-fabric/trace-projector.ts";
import { programDigest, type ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { buildAgentMemoryContext } from "../../src/forge/agent-memory/context-pack.ts";
import { buildAgentMemoryTraceContext } from "../../src/forge/agent-memory/trace-context.ts";
import { formatAgentMemoryHuman } from "../../src/forge/agent-memory/bridge.ts";
import { shutdownDeltaBroker } from "../../src/forge/delta/broker.ts";
import type { AgentEventEnvelope, AgentMemoryContextPack } from "../../src/forge/agent-memory/types.ts";

const cli = fileURLToPath(new URL("../../bin/forge.mjs", import.meta.url));
const generationId = "context-fixture-generation";
let fixture: Awaited<ReturnType<typeof createTraceFixture>>;
let finalRun: ProgramRunV2;
const key = () => ({ ...fixture.identity, runId: finalRun.runId });
const ref = (value: string) => programDigest(value);

async function fileHashes(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function visit(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(join(directory, entry.name), relative);
      else files[relative] = createHash("sha256").update(await readFile(join(directory, entry.name))).digest("hex");
    }
  }
  await visit(root);
  return files;
}

async function traceItem(pack: AgentMemoryContextPack) {
  const item = pack.trace.items.find(item => item.runKey.runId === finalRun.runId);
  if (!item) throw new Error(`Missing real fixture trace: ${JSON.stringify(pack.trace)}`);
  return item;
}

function runContextCli(root: string, json: boolean, scopeArgs = ["--handoff"]): string {
  const env: NodeJS.ProcessEnv = {};
  for (const name of ["PATH", "HOME", "USERPROFILE", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { FORGE_DELTA: "1", FORGE_DELTA_BACKGROUND_DRAIN: "0", FORGE_FABRIC_TEST_MODE: "1", FORGE_SMOKE_REAL: "0" });
  const result = spawnSync(process.env.FORGE_TRACE_NODE ?? "node", [cli, "agent", "context", ...scopeArgs, ...(json ? ["--json"] : [])], {
    cwd: root, env, encoding: "utf8", timeout: 45000,
  });
  if (result.error || result.status !== 0) throw new Error(`Context CLI failed: ${result.error ?? result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

beforeAll(async () => {
  fixture = await createTraceFixture({ identitySuffix: "context-consumer" });
  finalRun = (await fixture.complete()).run;
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId });
  const envelope: AgentEventEnvelope = {
    schema: "forge.agent-event.v1", source: { agent: "generic", integration: "manual-import", version: "context-fixture-v1" },
    workspace: { root: fixture.root }, session: { externalSessionId: "fresh-context-consumer", turnId: "new-task" },
    event: { kind: "agent.tool.completed", timestamp: "2026-10-15T12:00:00.000Z" },
    actor: { kind: "agent", name: "context-fixture-controller" }, payload: { status: "completed" },
    privacy: { rawPromptStored: false, rawCompletionStored: false, rawToolArgsStored: false, transcriptImported: false, redacted: true, sensitiveFieldsRemoved: [] },
    capture: { trustLevel: "manual-import", confidence: 1 },
  };
  await fixture.delta.recordAgentMemoryEvent({ envelope, summary: "New task revisits a public fixture file", bindings: {
    files: ["src/a.txt"], entries: ["notes.revise"], toolName: "fixture-read", status: "completed",
  } });
  // Public projection APIs add adversarial inventory neighbors. The positive run above
  // still comes from real Fabric command execution, review, gate, apply and Git objects.
  for (const foreign of [false, true]) {
    const runKey = { ...fixture.identity, runId: foreign ? "foreign-store-run" : "unrelated-run", ...(foreign ? { fabricStoreId: "foreign-store" } : {}) };
    const cut = { version: 1, journalRef: ref(`${runKey.runId}-journal`), stateRef: ref(`${runKey.runId}-state`) };
    await fixture.delta.traceProjectBatch({ generationId, runKey, cut, facts: [{
      journalVersion: 1, journalRef: cut.journalRef, stateRef: cut.stateRef,
      factKind: "snapshot", factIdentity: runKey.runId, sourceDigest: programDigest(runKey), entities: [
        { id: runKey.runId, kind: "run", data: { observedStatus: "applied" } },
        { id: `${runKey.runId}-candidate`, kind: "candidate", data: { candidateId: `${runKey.runId}-candidate`, candidateDigest: ref(runKey.runId), paths: [foreign ? "src/a.txt" : "other/c.txt"] } },
      ],
    }] });
  }
}, 120000);

afterAll(async () => { if (fixture) await fixture.close(); });

test("fresh Agent Memory context receives source-bound Fabric history with historical gate validity only", async () => {
  const pack = await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true });
  expect(pack.agentMemory.files).toContain("src/a.txt");
  expect(pack.trace).toMatchObject({ schema: "forge.agent-memory-trace-context.v1", status: "partial", mode: "historical-context-only", authority: "none", approvalForNewTask: "not-evaluated",
    selection: { basis: "workspace-observed-files", paths: ["src/a.txt"], causality: "not-inferred" }, projection: { generationId } });
  const item = await traceItem(pack);
  expect(item).toMatchObject({ runKey: key(), generationId, completeness: "complete-at-cut", execution: { observedStatus: "applied" }, authority: "none", approvalForNewTask: "not-evaluated" });
  expect(item.candidates.some(candidate => candidate.paths.includes("src/a.txt"))).toBe(true);
  expect(item.evidence.some(evidence => evidence.kind === "gate" && evidence.validity === "owner-gated-at-cut")).toBe(true);
  expect(item.evidence.some(evidence => evidence.kind === "assessment" && evidence.validity === "owner-gated-at-cut")).toBe(true);
  expect(item.git.observation).toBe("observed");
  expect(item.sources.length).toBeGreaterThan(0);
  expect(item).toMatchObject({ sourceCompleteness: "partial", sourceScope: "run-source-subset" });
  expect(item.sourcesTotal).toBeGreaterThan(item.sources.length);
  expect(item.sourcesOmitted).toBe(item.sourcesTotal - item.sources.length);
  expect(item.gaps).toContain("source-list-truncated");
  expect(pack.trace.gaps).toContain("source-list-truncated");
  expect(pack.trace.truncated).toBe(true);
  expect(item.sources.every(source => source.version <= item.cut.version && source.journalRef.startsWith("sha256:") && source.stateRef.startsWith("sha256:"))).toBe(true);
  expect(pack.trace.items.some(item => item.runKey.runId === "unrelated-run" || item.runKey.fabricStoreId === "foreign-store")).toBe(false);
  const serialized = JSON.stringify(pack.trace);
  for (const forbidden of [fixture.root, '"payload"', '"envelope"', '"argv"', '"rawPrompt"', '"contentBase64"']) expect(serialized).not.toContain(forbidden);
});

test("the trace helper itself reads the real fixture without recording operations or changing checkpoints", async () => {
  const before = { details: await fixture.delta.statusDetails(), projection: await fixture.delta.traceStatus(), timeline: await fixture.delta.timeline({}) };
  const endpointPath = join(fixture.root, ".forge/delta/broker-endpoint.json");
  const endpoint = await readFile(endpointPath);
  const trace = await buildAgentMemoryTraceContext({ workspaceRoot: fixture.root, scope: "handoff", events: [{ files: ["src/a.txt"], entries: [], proofs: [] }] });
  expect(trace.items.some(item => item.runKey.runId === finalRun.runId)).toBe(true);
  expect({ details: await fixture.delta.statusDetails(), projection: await fixture.delta.traceStatus(), timeline: await fixture.delta.timeline({}) }).toEqual(before);
  expect(await readFile(endpointPath)).toEqual(endpoint);
});

test("the trace helper with no configuration creates neither a database nor an owner", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-trace-context-absent-"));
  try {
    const before = await fileHashes(root);
    expect(await buildAgentMemoryTraceContext({ workspaceRoot: root, scope: "handoff" })).toMatchObject({ status: "disabled", items: [], authority: "none" });
    expect(await fileHashes(root)).toEqual(before);
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("entry mapping uses only matching observed files and does not borrow unmapped proof history", async () => {
  const mapped = await buildAgentMemoryContext({ workspaceRoot: fixture.root, entry: "notes.revise" });
  expect((await traceItem(mapped)).runKey).toEqual(key());
  for (const target of [{ entry: "unmapped.entry" }, { proof: "unmapped-proof" }]) {
    const unmapped = await buildAgentMemoryContext({ workspaceRoot: fixture.root, ...target });
    expect(unmapped.trace.selection.basis).toBe("unmapped-target");
    expect(unmapped.trace.items).toEqual([]);
    expect(unmapped.trace.authority).toBe("none");
    expect(unmapped.agentMemory.summary.events).toBe(0);
  }
  for (const scope of ["proof", "change"] as const) {
    const pack = JSON.parse(runContextCli(fixture.root, true, [`--${scope}`, `unmapped-${scope}`])) as AgentMemoryContextPack;
    expect(pack.scope).toBe(scope);
    expect(pack.scopeTarget).toMatchObject({ kind: scope, value: `unmapped-${scope}` });
  }
});

test("real agent context CLI delivers trace history to a fresh handoff consumer without trace-specific flags", async () => {
  const pack = JSON.parse(runContextCli(fixture.root, true)) as AgentMemoryContextPack;
  expect(pack.ok).toBe(true);
  expect(pack.scope).toBe("handoff");
  expect(pack.trace).toMatchObject({ mode: "historical-context-only", authority: "none", approvalForNewTask: "not-evaluated", projection: { generationId } });
  expect((await traceItem(pack)).evidence.some(evidence => evidence.kind === "gate" && evidence.validity === "owner-gated-at-cut")).toBe(true);
  expect(pack.trace.items.some(item => item.runKey.runId === "unrelated-run" || item.runKey.fabricStoreId === "foreign-store")).toBe(false);
});

test("human formatter and real text CLI show historical validity, cut and absence of new-task approval", async () => {
  const pack = await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true });
  const item = await traceItem(pack);
  const source = item.sources[0];
  if (!source) throw new Error("Real context fixture has no source references");
  for (const text of [formatAgentMemoryHuman(pack), runContextCli(fixture.root, false)]) {
    expect(text).toContain("Trace history:");
    expect(text).toContain("historical-context-only");
    expect(text).toContain("authority: none");
    expect(text).toContain("approval for new task: not-evaluated");
    expect(text).toContain("owner-gated-at-cut");
    expect(text).toContain(finalRun.runId);
    expect(text).toContain(generationId);
    expect(text).toContain("cut:");
    expect(text).toContain(item.cut.journalRef);
    expect(text).toContain(item.cut.stateRef);
    expect(text).toContain(source.sourceKey);
    expect(text).toContain(source.digest);
    expect(text).toContain("source availability: primary-source-unverified");
    expect(text).toContain("source scope: run-source-subset");
    expect(text).toContain("source-list-truncated");
    expect(text).not.toContain(fixture.root);
  }
});

test("missing trace configuration preserves the existing Agent Memory context without inventing bindings", async () => {
  const configurationPath = join(fixture.root, ".forge/fabric-trace.json");
  const configuration = await readFile(configurationPath);
  try {
    await rm(configurationPath);
    const pack = await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true });
    expect(pack.ok).toBe(true);
    expect(pack.agentMemory.files).toContain("src/a.txt");
    expect(pack.trace).toMatchObject({ status: "disabled", mode: "historical-context-only", authority: "none", items: [] });
  } finally { await writeFile(configurationPath, configuration); }
});

test("context pins its source cut and reports a later correction as superseded historical Git", async () => {
  const before = await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true });
  const beforeItem = await traceItem(before);
  const store = await fixture.store();
  const cut = (await store.cut(finalRun.runId))!;
  const artifacts = await store.traceArtifacts(finalRun.runId, { journalRef: cut.journalRef });
  const original = artifacts.artifacts.find(artifact => artifact.type === "annotation" && artifact.value.type === "git-observation");
  if (!original) throw new Error("Missing real Git observation to correct");
  finalRun = await fixture.service.execute("program-trace-annotate", {
    runId: finalRun.runId, requestId: "context-correction", expectedVersion: finalRun.version,
    annotation: { type: "correction", supersedesRef: original.ref, reason: "clarify public fixture evidence", replacement: { summary: "fixture host declaration only", producer: "fixture-controller" } },
  }) as ProgramRunV2;
  const pinned = await traceItem(await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true }));
  expect(pinned.cut).toEqual(beforeItem.cut);
  await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId });
  const pack = await buildAgentMemoryContext({ workspaceRoot: fixture.root, handoff: true });
  const corrected = await traceItem(pack);
  expect(corrected.cut.version).toBeGreaterThan(beforeItem.cut.version);
  expect(corrected.git).toMatchObject({ observation: "unknown", contentMatch: "not-evaluated" });
  expect(corrected.corrections).toEqual(expect.arrayContaining([expect.objectContaining({ supersedesRef: original.ref, reason: "clarify public fixture evidence", replacement: { summary: "fixture host declaration only", producer: "fixture-controller" } })]));
  expect(corrected.gaps).toContain("git-observation-superseded");
  expect(corrected.authority).toBe("none");
  expect(corrected.approvalForNewTask).toBe("not-evaluated");
  expect((await traceItem(before)).cut).toEqual(beforeItem.cut);
}, 120000);

test("configured trace history with an offline fixture broker leaves the existing database bytes untouched", async () => {
  await fixture.delta.close();
  await shutdownDeltaBroker(fixture.root);
  const before = await fileHashes(join(fixture.root, ".forge/delta"));
  const trace = await buildAgentMemoryTraceContext({ workspaceRoot: fixture.root, scope: "handoff", events: [{ files: ["src/a.txt"], entries: [], proofs: [] }] });
  expect(trace).toMatchObject({ status: "unavailable", authority: "none", items: [] });
  expect(await fileHashes(join(fixture.root, ".forge/delta"))).toEqual(before);
}, 120000);
