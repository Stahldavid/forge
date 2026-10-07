import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProgramRunService } from "../../src/forge/agent-fabric/program-service.ts";
import { programDigest, type ProgramRegistry, type ProgramRunV2 } from "../../src/forge/agent-fabric/program-contract.ts";
import { lowerWorkflowSource, schemaRef } from "../../src/forge/agent-fabric/program-dsl.ts";

export async function runUiFixture(count = 20, defects = [2, 9, 17], browserPath?: string) {
  const root = await mkdtemp(join(tmpdir(), "forge-ui-fixture-"));
  let service: ProgramRunService | undefined;
  const startedAt = performance.now();
  try {
    await mkdir(join(root, "src")); await mkdir(join(root, ".forge"));
    for (let index = 0; index < count; index++) await writeFile(join(root, "src", `ui-${String(index).padStart(2, "0")}.html`), `<!doctype html><html><title>UI ${index}</title><body data-fixture="${defects.includes(index) ? "bad" : "good"}"><h1>Local fixture ${index}</h1></body></html>`);
    for (const args of [["init", "--quiet"], ["add", "src"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "UI fixture baseline"]]) {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }); if (result.status) throw new Error(result.stderr);
    }
    const registry: ProgramRegistry = { schemas: { "any@v2": {} }, executors: {}, policies: {}, acceptance: {}, populations: {} };
    const worker = fileURLToPath(new URL("./ui-fixture-worker.cjs", import.meta.url));
    for (const id of ["discover", "capture", "implement", "review", "local-check", "global-check"]) registry.executors[`${id}@v2`] = {
      id, version: "v2", kind: "command", effect: id === "implement" ? "isolated-write" : "read", role: id === "implement" ? "implementer" : id === "review" ? "reviewer" : "investigator",
      argv: [process.execPath, worker, id, ...(id === "capture" && browserPath ? [browserPath] : [])], timeoutMs: id === "capture" && browserPath ? 120000 : 10000, writeScope: id === "implement" ? ["src"] : [], network: "host", isolation: "cooperative", schema: schemaRef("any", "v2")
    };
    registry.policies["local@v2"] = { id: "local", version: "v2", concurrency: 4, maxItems: 100, maxAttempts: 500, maxOperations: 2000, maxDepth: 12, deadlineMs: 240000, maxOutputBytes: 4 * 1024 * 1024, writeScope: ["src"], executors: Object.keys(registry.executors), allowNetwork: true, allowCooperativeCommands: true };
    registry.acceptance["ui@v2"] = { id: "ui", version: "v2", criteria: ["Known fixture attributes are correct"], requireReview: true, allowNoWork: false, writeScope: ["src"], requiredChecks: [],
      requiredChecksByScope: { item: ["local-check@v2"], final: ["global-check@v2"] }, assessmentBindings: { page: "item", final: "final" },
      obligations: [{ id: "layout", scope: "item", criteria: ["known fixture constraint"], requiredEvidence: ["capture"] }, { id: "integration", scope: "final", criteria: ["all pages correct together"] }] };
    registry.populations["pages@v2"] = { id: "pages", version: "v2", members: [], baselineDigest: "owner-capture", inventoryRoots: ["src"], extensions: [".html"], exclusions: [], allowNoWork: false, evidence: "owner filesystem inventory" };
    await writeFile(join(root, ".forge/fabric-programs.json"), JSON.stringify(registry));
    const source = await readFile(new URL("./ui-audit.workflow.ts", import.meta.url), "utf8"), program = lowerWorkflowSource(source);
    service = await ProgramRunService.open(root);
    const initial = await service.execute("program-start", { requestId: "ui-fixture", program, input: {} }) as ProgramRunV2;
    let run: ProgramRunV2;
    do { await new Promise(resolve => setTimeout(resolve, 20)); run = (await service.store.read(initial.runId))!; } while (run.status === "executing");
    if (run.status !== "acceptance-ready") throw new Error(`UI fixture failed: ${run.status}: ${run.reason}`);
    const assessment = Object.values(run.assessments).find(receipt => receipt.phase === "final")!;
    const implementations = Object.values(run.attempts).filter(attempt => attempt.operationId.endsWith("/implement"));
    const beforeApply = await readFile(join(root, "src", `ui-${String(defects[0] ?? 0).padStart(2, "0")}.html`), "utf8");
    const report = { datasetDigest: programDigest({ count, defects }), pages: count, knownDefects: defects.length, implementations: implementations.length, attempts: run.totalAttempts,
      captures: Object.keys(run.artifactRecords ?? {}).length, finalObligations: assessment.satisfiedObligationIds?.length, finalCaptures: assessment.evidenceRefs?.length,
      destinationPreserved: beforeApply.includes(`data-fixture="${defects.length ? "bad" : "good"}"`), llmCalls: 0, elapsedMs: Math.round(performance.now() - startedAt), storage: service.store.metrics,
      captureMode: browserPath ? "local-headless-browser" : "png-fixture", limitations: [browserPath ? "Local browser rendering; no visual model evaluation" : "PNG fixtures; no browser rendering or visual model evaluation", "Cooperative command isolation", "No automatic apply; no Claude benchmark"] };
    return report;
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
}
if (import.meta.main) { process.env.FORGE_FABRIC_TEST_MODE = "1"; console.log(JSON.stringify(await runUiFixture(), null, 2)); }
