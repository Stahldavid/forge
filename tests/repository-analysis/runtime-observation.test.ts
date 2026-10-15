import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { observeRepositoryRuntime, planRepositoryRuntime, readRuntimeObservation, runtimeSourceDigest, selectRuntimeObservation } from "../../src/forge/repository-analysis/runtime-observation.ts";

const roots: string[] = [];
function fixture(script = "import {writeFileSync} from 'node:fs'; writeFileSync('observed.json', JSON.stringify({facts:[{kind:'runtime-resource',name:'Orders',details:{type:'OrderRegistry'}}]}));") {
  const root = mkdtempSync(join(tmpdir(), "forge-runtime-runner-test-")); roots.push(root);
  mkdirSync(join(root, "web")); writeFileSync(join(root, "web/main.ts"), "export const orders = 1;"); writeFileSync(join(root, "web/export.mjs"), script);
  const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"], files: ["main.ts"] }], runtime: { observations: [{ id: "registry", component: "web", commands: [{ argv: [process.execPath, "export.mjs"], timeoutMs: 10000 }], artifacts: [{ path: "web/observed.json", format: "forge-runtime" }] }] } };
  return { root, manifest };
}
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-runtime-runner-test-")) throw new Error("Unsafe runtime test cleanup"); rmSync(root, { recursive: true, force: true }); } });

describe("explicit isolated repository runtime observations", () => {
  test("planning is pure, validates binding and does not export artifacts", async () => {
    const { root, manifest } = fixture(); const snapshot = await analyzeRepository(root, manifest);
    const plan = planRepositoryRuntime(snapshot, "local-test"); expect(plan.execution).toBe("not-executed"); expect(plan.observations).toHaveLength(1);
    expect(existsSync(join(root, "web/observed.json"))).toBe(false); expect(existsSync(join(root, ".forge"))).toBe(false);
    expect(() => planRepositoryRuntime(snapshot, "https://secret.invalid")).toThrow("environmentId");
    expect(() => planRepositoryRuntime(snapshot, "local", "missing")).toThrow("Unknown");
    expect(() => planRepositoryRuntime({ ...snapshot, snapshotId: "repo:bad" }, "local")).toThrow("binding");
  });

  test("real commands run in independent copy, strip credentials and user configuration, and publish minimized facts", async () => {
    const script = "import {writeFileSync,existsSync} from 'node:fs'; if(process.env.FORGE_TEST_RUNTIME_TOKEN || process.env.NODE_OPTIONS || existsSync('../.env') || existsSync('../.GIT') || existsSync('../.AWS') || existsSync('../node_modules'))process.exit(7); writeFileSync('observed.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'Orders',details:{type:'OrderRegistry',authorization:'discard-me'}}]}));";
    const { root, manifest } = fixture(script); writeFileSync(join(root, ".env"), "TOKEN=private-value"); mkdirSync(join(root, ".GIT")); mkdirSync(join(root, ".AWS")); mkdirSync(join(root, "node_modules")); writeFileSync(join(root, "web/observed.json"), "original");
    const previous = process.env.FORGE_TEST_RUNTIME_TOKEN; process.env.FORGE_TEST_RUNTIME_TOKEN = "not-copied";
    try {
      const report = await observeRepositoryRuntime(root, manifest, { environmentId: "isolated-local", write: true });
      expect(report.observations[0].status).toBe("completed"); expect(report.observations[0].commands[0].exitCode).toBe(0); expect(report.observations[0].facts[0].name).toBe("Orders");
      expect(JSON.stringify(report)).not.toContain("private-value"); expect(JSON.stringify(report)).not.toContain("discard-me"); expect(JSON.stringify(report)).not.toContain("not-copied");
      expect(readFileSync(join(root, "web/observed.json"), "utf8")).toBe("original");
      const snapshot = await analyzeRepository(root, manifest); expect(readRuntimeObservation(root, snapshot).reportId).toBe(report.reportId);
      expect(() => readRuntimeObservation(root, snapshot, { environmentId: "different" })).toThrow("environment");
      const selected = selectRuntimeObservation(report, { query: "Orders", scope: ["web"], maxChars: 2000 }); expect(selected.facts).toHaveLength(1); expect(selected.assurance).toBe("observed-artifact"); expect(JSON.stringify(selected).length).toBeLessThanOrEqual(2000);
    } finally { if (previous === undefined) delete process.env.FORGE_TEST_RUNTIME_TOKEN; else process.env.FORGE_TEST_RUNTIME_TOKEN = previous; }
  }, 30000);

  test("readonly execution leaves no caches and missing generated artifacts cannot reuse copied exports", async () => {
    const { root, manifest } = fixture("process.exit(0);"); writeFileSync(join(root, "web/observed.json"), '{"facts":[{"kind":"runtime-resource","name":"Old"}]}');
    const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local" }); expect(report.observations[0].status).toBe("failed"); expect(report.observations[0].facts).toHaveLength(0); expect(report.observations[0].artifacts).toHaveLength(0);
    expect(existsSync(join(root, ".forge"))).toBe(false); expect(readFileSync(join(root, "web/observed.json"), "utf8")).toContain("Old");
  }, 30000);

  test("failed commands cannot promote artifacts produced before failure", async () => {
    const { root, manifest } = fixture("import{writeFileSync}from'node:fs';writeFileSync('observed.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'Partial'}]}));process.exit(4);");
    const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local" }); expect(report.observations[0].status).toBe("failed"); expect(report.observations[0].commands[0].exitCode).toBe(4); expect(report.observations[0].facts).toHaveLength(0);
  }, 30000);

  test("timeout stops the owned command and returns no facts", async () => {
    const { root, manifest } = fixture("setInterval(()=>{},1000);"); manifest.runtime!.observations[0].commands[0].timeoutMs = 2000;
    const started = Date.now(); const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local" });
    expect(report.observations[0].status).toBe("timed-out"); expect(report.observations[0].facts).toHaveLength(0); expect(Date.now() - started).toBeLessThan(20000);
  }, 30000);

  test("cancellation stops a running command and does not execute later observations", async () => {
    const { root, manifest } = fixture("setInterval(()=>{},1000);"); const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 2000);
    manifest.runtime!.observations.push({ ...manifest.runtime!.observations[0], id: "later" });
    try { const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local", signal: abort.signal }); expect(report.observations.map(item => item.status)).toEqual(["cancelled", "cancelled"]); expect(report.observations[1].commands).toHaveLength(0); }
    finally { clearTimeout(timer); }
  }, 30000);

  test("full-input binding includes lockfiles, config and scripts excluded from static maps", async () => {
    const { root, manifest } = fixture(); manifest.exclude = ["**/package-lock.json", "**/hidden.config.mjs", "**/hidden.mjs"]; writeFileSync(join(root, "package-lock.json"), '{"lockfileVersion":3}'); writeFileSync(join(root, "hidden.config.mjs"), "export const mode = 'test';"); writeFileSync(join(root, "hidden.mjs"), "export const extra = 1;");
    const script = "import{readFileSync,writeFileSync}from'node:fs';if(!readFileSync('../package-lock.json','utf8').includes('lockfileVersion')||!readFileSync('../hidden.mjs','utf8'))process.exit(8);writeFileSync('observed.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'Configured'}]}));"; writeFileSync(join(root, "web/export.mjs"), script);
    const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local", write: true }); expect(report.observations[0].status).toBe("completed"); const snapshot = await analyzeRepository(root, manifest); expect(readRuntimeObservation(root, snapshot).digest).toBe(report.digest);
    const before = runtimeSourceDigest(root, manifest); writeFileSync(join(root, "hidden.mjs"), "export const extra = 2;"); expect(runtimeSourceDigest(root, manifest)).not.toBe(before); expect(() => readRuntimeObservation(root, snapshot)).toThrow("stale");
  }, 30000);

  test("source changes during command invalidate publication", async () => {
    const { root, manifest } = fixture(); writeFileSync(join(root, "web/export.mjs"), `import{writeFileSync}from'node:fs';writeFileSync(${JSON.stringify(join(root, "web/main.ts"))},'export const orders=2;');writeFileSync('observed.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'Changed'}]}));`);
    await expect(observeRepositoryRuntime(root, manifest, { environmentId: "local", write: true })).rejects.toThrow("source changed"); expect(existsSync(join(root, ".forge/repository/runtime-observation.json"))).toBe(false);
  }, 30000);

  test("corrupted report and unsafe cache directory fail closed", async () => {
    const { root, manifest } = fixture(); await observeRepositoryRuntime(root, manifest, { environmentId: "local", write: true }); const snapshot = await analyzeRepository(root, manifest); const path = join(root, ".forge/repository/runtime-observation.json"); const report = JSON.parse(readFileSync(path, "utf8")); report.environmentId = "tampered"; writeFileSync(path, JSON.stringify(report)); expect(() => readRuntimeObservation(root, snapshot)).toThrow("integrity");
    writeFileSync(path, "RAW_REPORT_CREDENTIAL_VALUE invalid JSON");
    expect(() => readRuntimeObservation(root, snapshot)).toThrow("Invalid runtime report JSON");
    try { readRuntimeObservation(root, snapshot); } catch (error) { expect((error as Error).message).not.toContain("RAW_REPORT_CREDENTIAL_VALUE"); }
    const outside = mkdtempSync(join(tmpdir(), "forge-runtime-runner-test-")); roots.push(outside); rmSync(join(root, ".forge"), { recursive: true, force: true });
    try { symlinkSync(outside, join(root, ".forge"), process.platform === "win32" ? "junction" : "dir"); } catch { return; }
    await expect(observeRepositoryRuntime(root, manifest, { environmentId: "local", write: true })).rejects.toThrow("symlink"); expect(existsSync(join(outside, "repository"))).toBe(false);
  }, 30000);

  test("declared observation selection executes only the selected finite export", async () => {
    const { root, manifest } = fixture(); manifest.runtime!.observations.push({ ...manifest.runtime!.observations[0], id: "other", commands: [{ argv: [process.execPath, "-e", "process.exit(9)"] }] });
    const report = await observeRepositoryRuntime(root, manifest, { environmentId: "local", observationId: "registry" }); expect(report.observations).toHaveLength(1); expect(report.observations[0].status).toBe("completed");
    expect(() => selectRuntimeObservation(report, { maxChars: 16001 })).toThrow("maxChars"); expect(() => selectRuntimeObservation(report, { scope: ["other"], maxChars: 2000 })).not.toThrow(); expect(selectRuntimeObservation(report, { scope: ["other"], maxChars: 2000 }).facts).toHaveLength(0);
  }, 30000);
});
