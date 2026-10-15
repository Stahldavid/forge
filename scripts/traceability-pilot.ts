/** Deterministic fixture pilot. Requires an externally isolated Linux network namespace. */
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createTraceFixture, fixtureGit } from "../tests/agent-fabric/trace-fixture.ts";
import { projectFabricTrace } from "../src/forge/agent-fabric/trace-projector.ts";
import { explainFabricTrace } from "../src/forge/agent-fabric/trace-reader.ts";
import { shutdownDeltaBroker } from "../src/forge/delta/broker.ts";
import type { TraceRunKey } from "../src/forge/agent-fabric/trace-contract.ts";
import { deriveExpectedTraceEdges } from "./traceability-pilot-oracle.ts";

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
// Independent canonical JSON implementation for the JSON-only fixture source.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
}
function assert(condition: unknown, label: string): asserts condition { if (!condition) throw new Error(`TRACE_PILOT_ASSERTION:${label}`); }
async function bytes(root: string): Promise<{ files: number; bytes: number }> {
  let files = 0, total = 0;
  for (const item of await readdir(root, { withFileTypes: true })) {
    const path = join(root, item.name);
    if (item.isDirectory()) { const nested = await bytes(path); files += nested.files; total += nested.bytes; }
    else if (item.isFile()) { files++; total += (await stat(path)).size; }
  }
  return { files, bytes: total };
}
async function independentSourceReadback(directory: string, expectedKey: TraceRunKey, cut: { journalRef: string; stateRef: string; version: number }) {
  const runId = expectedKey.runId;
  const verifiedRefs = new Set<string>();
  const get = async (ref: string): Promise<Record<string, unknown>> => {
    assert(/^sha256:[a-f0-9]{64}$/.test(ref), "source-ref-shape");
    const value = JSON.parse(await readFile(join(directory, "artifacts", `${ref.slice(7)}.json`), "utf8"));
    assert(`sha256:${hash(canonical(value))}` === ref, "independent-cas-hash"); verifiedRefs.add(ref); return value;
  };
  const envelope = JSON.parse(await readFile(join(directory, `${hash(canonical(runId))}.json`), "utf8"));
  assert(envelope.digest === `sha256:${hash(canonical(envelope.record))}`, "independent-envelope-hash");
  assert(envelope.record.runId === runId && envelope.record.format === 4, "independent-envelope-run-format");
  assert(envelope.record.journalRef === cut.journalRef && envelope.record.stateRef === cut.stateRef && envelope.record.version === cut.version, "independent-envelope-committed-cut");
  let next: string | undefined = cut.journalRef, previousVersion: number | undefined;
  const seen = new Set<string>(), history: { version: number; journalRef: string; stateRef: string; type: string }[] = [];
  while (next) {
    assert(!seen.has(next) && seen.size < 4096, "source-acyclic-budget"); seen.add(next);
    const entry = await get(next), version = Number(entry.version);
    assert(entry.runId === runId && (previousVersion === undefined || version === previousVersion - 1), "independent-journal-ancestry");
    const stateRef = String(entry.stateRef), state = await get(stateRef);
    assert(state.runId === runId && state.version === version && entry.stateDigest === stateRef, "independent-state-binding");
    for (const field of ["gateRef", "receiptRef"]) if (state[field]) await get(String(state[field]));
    if (state.traceBindingsRef) {
      const manifest = await get(String(state.traceBindingsRef));
      const key = manifest.runKey as Record<string, unknown>;
      assert(canonical(key) === canonical(expectedKey), "independent-manifest-run-key");
      for (const field of ["originRefs", "annotationRefs"]) {
        assert(Array.isArray(manifest[field]), "independent-typed-manifest");
        for (const ref of manifest[field] as string[]) {
          const metadata = await get(ref);
          if (field === "originRefs") assert(metadata.runId === runId && metadata.repositoryId === key.repositoryId && metadata.checkoutId === key.checkoutId && metadata.fabricStoreId === key.fabricStoreId, "independent-origin-run-key");
          else assert(canonical(metadata.runKey) === canonical(key), "independent-annotation-run-key");
        }
      }
    }
    history.push({ version, journalRef: next, stateRef, type: String(entry.type) }); previousVersion = version;
    next = typeof entry.parentRef === "string" ? entry.parentRef : undefined;
  }
  assert(previousVersion === 1, "source-complete-from-version-one");
  return { verifier: "independent atomic envelope, JSON CAS hashes, descending journal/state ancestry, typed origin/annotation children and direct gate/apply receipts; no projector/extractor imported", versions: history.length, verifiedCasRefs: verifiedRefs.size, history, digest: hash(canonical(history)) };
}
export async function runTraceabilityPilot(output: string) {
  assert(process.env.FORGE_FABRIC_TEST_MODE === "1" && isAbsolute(output), "explicit-fixture-mode-and-absolute-output-required");
  assert(process.platform === "linux", "linux-namespace-required");
  const netDevices = (await readFile("/proc/net/dev", "utf8")).split("\n").filter(line => line.includes(":")) .map(line => line.split(":")[0]!.trim());
  assert(netDevices.length === 1 && netDevices[0] === "lo", "network-namespace-must-have-loopback-only");
  const routes = (await readFile("/proc/net/route", "utf8")).trim().split("\n").slice(1);
  assert(routes.length === 0, "network-namespace-must-have-no-routes");
  for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "AI_GATEWAY_API_KEY", "GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete process.env[key];
  Object.assign(process.env, { FORGE_SMOKE_REAL: "0", FORGE_DELTA_BACKGROUND_DRAIN: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: "/dev/null", GIT_TERMINAL_PROMPT: "0" });
  assert(process.env.FORGE_TRACE_LEGACY_SOURCE && process.env.FORGE_TRACE_NODE, "preserved-legacy-reader-and-node-required");
  await mkdir(output, { recursive: true });
  const suites = ["tests/agent-fabric/trace-fabric.test.ts", "tests/agent-fabric/trace-git.test.ts", "tests/agent-fabric/trace-extractor.test.ts", "tests/agent-fabric/trace-crash.test.ts", "tests/agent-fabric/trace-integration.test.ts", "tests/agent-fabric/trace-cli.test.ts", "tests/delta/trace-projection.test.ts", "tests/agent-memory/h48-agent-memory.test.ts", "tests/agent-memory/trace-context.test.ts", "tests/agent-memory/trace-context-integration.test.ts"];
  const started = performance.now();
  const tests = spawnSync("bun", ["test", ...suites, "--timeout", "120000", "--reporter=junit", `--reporter-outfile=${join(output, "tests.junit.xml")}`], { cwd: process.cwd(), env: process.env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 600000 });
  await writeFile(join(output, "tests.log"), `${tests.stdout ?? ""}${tests.stderr ?? ""}`, { flag: "wx" });
  if (tests.status !== 0) { await writeFile(join(output, "failure.json"), JSON.stringify({ schema: "forge.trace-pilot-failure.v1", exitCode: tests.status, signal: tests.signal, testLog: "tests.log" }, null, 2)); throw new Error("TRACE_PILOT_TEST_FAILURE"); }
  const fixture = await createTraceFixture({ identitySuffix: "evidence" });
  try {
    const baselineHead = fixtureGit(fixture.root, "rev-parse", "HEAD"), { run, observation } = await fixture.complete();
    const store = await fixture.store(), cut = (await store.cut(run.runId))!, key = { ...fixture.identity, runId: run.runId };
    const projectionStart = performance.now();
    const projected = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "pilot-evidence-A" });
    const projectionMs = performance.now() - projectionStart;
    const explanation = await explainFabricTrace(fixture.root, { runKey: key, limit: 256 }) as { relations: { relation: { from: string; to: string; predicate: string; provenance: { claimKind: string; authority: string } } }[]; entities: { id: string }[]; agentMemory: { availability: string } };
    const expectedPredicates = ["requested-by", "recorded-as", "produced-by", "assessed-by", "includes-check", "gated-by", "applied-as", "contains-candidate-content", "commit-linked-by-host"];
    const entityIds = new Set(explanation.entities.map(item => item.id));
    const positiveCatalog = expectedPredicates.map(predicate => {
      const edges = explanation.relations.filter(item => item.relation.predicate === predicate);
      return { predicate, found: edges.length, resolved: edges.length > 0 && edges.every(item => entityIds.has(item.relation.from) && entityIds.has(item.relation.to)) };
    });
    assert(positiveCatalog.every(item => item.resolved), "positive-catalog-endpoints");
    const independentEdges = await deriveExpectedTraceEdges({ directory: store.directory, runId: run.runId, journalRef: cut.journalRef });
    const observedEdges = explanation.relations.filter(item => expectedPredicates.includes(item.relation.predicate)).map(item => ({ from: item.relation.from, to: item.relation.to, predicate: item.relation.predicate }));
    const normalizeEdges = (edges: typeof observedEdges) => [...new Map(edges.map(edge => [canonical(edge), edge])).values()].sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
    assert(canonical(normalizeEdges(observedEdges)) === canonical(normalizeEdges(independentEdges.expectedEdges)), "independent-exact-edge-oracle");
    assert(explanation.agentMemory.availability === "available", "confirmed-primary-event");
    assert(explanation.relations.every(item => item.relation.provenance.authority === "none"), "trace-never-grants-authority");
    const provenanceCatalog = expectedPredicates.map(predicate => ({ predicate, expectedClaimKind: ["requested-by", "recorded-as", "commit-linked-by-host"].includes(predicate) ? "declared" : "observed" }));
    assert(provenanceCatalog.every(item => explanation.relations.filter(edge => edge.relation.predicate === item.predicate).every(edge => edge.relation.provenance.claimKind === item.expectedClaimKind)), "independent-fixture-provenance-catalog");
    assert(explanation.relations.filter(item => item.relation.predicate === "commit-linked-by-host").every(item => item.relation.provenance.claimKind === "declared"), "host-link-remains-declared");
    const oid = fixtureGit(fixture.root, "rev-parse", "HEAD"), parents = fixtureGit(fixture.root, "rev-list", "--parents", "-n", "1", oid).split(" ").slice(1);
    assert(parents.length === 1 && parents[0] === baselineHead, "independent-git-parent");
    const gitFiles = ["src/a.txt", "src/b.txt"].map((path, i) => {
      const actual = execFileSync("git", ["-C", fixture.root, "cat-file", "blob", `${oid}:${path}`], { env: process.env });
      const expected = Buffer.from(i === 0 ? "new-a\n" : "new-b\n");
      assert(actual.equals(expected), "independent-git-expected-bytes");
      const mode = fixtureGit(fixture.root, "ls-tree", oid, "--", path).split(" ")[0]; assert(mode === "100644", "independent-git-mode");
      return { path, mode, bytes: actual.length, sha256: hash(actual) };
    });
    assert(fixtureGit(fixture.root, "diff-tree", "--no-commit-id", "--name-only", "-r", oid).split("\n").sort().join(",") === "src/a.txt,src/b.txt", "independent-git-no-outside-change");
    const sourceReadback = await independentSourceReadback(store.directory, key, cut);
    const closure = await store.traceArtifacts(run.runId, { journalRef: cut.journalRef });
    const replay = [];
    for (let sample = 0; sample < 30; sample++) {
      const start = performance.now(), result = await projectFabricTrace({ root: fixture.root, identity: fixture.identity, delta: fixture.delta, generationId: "pilot-evidence-A" });
      assert(result.results.every(item => item.inserted === 0 && item.sourceVersions === 0), "no-op-source-suffix");
      replay.push({ ms: performance.now() - start, ...result.sourceReadMetrics });
    }
    await writeFile(join(output, "positive-explanation.json"), `${JSON.stringify(explanation, null, 2)}\n`, { flag: "wx" });
    await writeFile(join(output, "metadata-cas.json"), `${JSON.stringify(closure, null, 2)}\n`, { flag: "wx" });
    await writeFile(join(output, "source-readback.json"), `${JSON.stringify(sourceReadback, null, 2)}\n`, { flag: "wx" });
    await writeFile(join(output, "independent-edges.json"), `${JSON.stringify(independentEdges, null, 2)}\n`, { flag: "wx" });
    const fabricStorage = await bytes(store.directory);
    await fixture.close(true); await shutdownDeltaBroker(fixture.root);
    const deltaStorage = await bytes(fixture.delta.storePath);
    await fixture.close();
    const report = { schema: "forge.trace-pilot-evidence.v1", runtime: { node: process.version, bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(), git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim() },
      namespace: { devices: netDevices, externalRoutes: routes.length }, tests: { exitCode: tests.status, suites, junit: "tests.junit.xml", log: "tests.log" },
      cut, runKey: key, positiveCatalog: { predicateDenominator: expectedPredicates.length, predicatesResolved: positiveCatalog.filter(item => item.resolved).length, edgeDenominator: independentEdges.expectedEdges.length, exactEdgesMatched: independentEdges.expectedEdges.length, oracle: "independent-edges.json", items: positiveCatalog },
      provenanceCatalog,
      git: { oid, parents, expectedBaselineHead: baselineHead, files: gitFiles, productionObservation: observation, verifier: "fixture-controller expected bytes/modes/parent and actual Git objects; independent of trace observer" },
      projection: { durationMs: projectionMs, result: projected, warmNoOp: replay }, storage: { fabric: fabricStorage, delta: deltaStorage, meaning: "logical file bytes; Fabric CAS/journal/envelope combined, Delta fixture excludes broker metadata; no production sizing claim" },
      boundaries: { realHooksActivated: false, providersInvoked: false, externalNetwork: false, push: false, deploy: false, gitCommits: "disposable fixtures only", fixtureRemoved: true },
      sourceReadback: { versions: sourceReadback.versions, digest: sourceReadback.digest, file: "source-readback.json" }, totalMs: performance.now() - started };
    await writeFile(join(output, "pilot.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    return report;
  } finally { await fixture.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2); assert(args.length === 2 && args[0] === "--output", "usage: --output /absolute/new-directory");
  const result = await runTraceabilityPilot(args[1]!); process.stdout.write(`${JSON.stringify({ schema: result.schema, tests: result.tests.exitCode, resolved: result.positiveCatalog, totalMs: result.totalMs })}\n`);
}
