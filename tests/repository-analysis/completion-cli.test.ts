import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { readRepositorySnapshot } from "../../src/forge/repository-analysis/context.ts";
import { runRepositoryCommand } from "../../src/forge/cli/repository.ts";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";

const roots: string[] = [];
const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }] };
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge-completion-cli-")); roots.push(root);
  mkdirSync(join(root, "web")); writeFileSync(join(root, "web/main.ts"), "export function useful() { return true; }");
  writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
  await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  const cases = join(root, "cases.json"), modelConfig = join(root, "model.json");
  writeFileSync(cases, JSON.stringify([{ id: "useful", query: "useful", scope: ["web/main.ts"], expectedFiles: ["web/main.ts"] }]));
  writeFileSync(modelConfig, JSON.stringify({ provider: "codex", name: "reviewed-model", settings: { reasoningEffort: "high" } }));
  return { root, cases, modelConfig };
}
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-completion-cli-")) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });

test("paired plan CLI output round-trips into report CLI, preserves pending evidence and rejects changed inputs", async () => {
  const { root, cases, modelConfig } = await fixture(), before = readFileSync(join(root, ".forge/repository/snapshot.json"), "utf8");
  const args = ["repository", "benchmark-plan", "--root", root, "--cases", cases, "--model-config", modelConfig, "--repetitions", "2", "--json"];
  expect(parseCli(args).errors).toEqual([]); expect(hasUnknownOption(args)).toBeNull();
  const result = await runRepositoryCommand({ action: "benchmark-plan", cwd: root, root, cases, modelConfig, repetitions: 2, write: false, json: true });
  expect(result.exitCode).toBe(0); const plan = result.plan as any;
  expect(plan.runs.length).toBe(4); expect(plan.execution).toBe("not-executed");
  const path = join(root, "plan.json"), observations = join(root, "observations.json");
  writeFileSync(path, JSON.stringify(result)); writeFileSync(observations, "[]");
  const report = await runRepositoryCommand({ action: "benchmark-report", cwd: root, root, plan: path, observations, write: false, json: true });
  expect(report.exitCode).toBe(0); expect(report.comparablePairs).toBe(0); expect((report.pairs as any[]).every(pair => pair.status === "pending")).toBe(true);
  expect(readFileSync(join(root, ".forge/repository/snapshot.json"), "utf8")).toBe(before);
  expect(parseCli([...args, "--write"]).errors.length).toBeGreaterThan(0);
  expect(parseCli(["repository", "cache-gc", "--model-config", modelConfig]).errors.length).toBeGreaterThan(0);
  expect(parseCli(["repository", "benchmark-report", "--plan", path, "--observations", observations]).errors).toEqual([]);
  writeFileSync(join(root, "web/main.ts"), "export function changed() { return false; }");
  expect((await runRepositoryCommand({ action: "benchmark-report", cwd: root, root, plan: path, observations, write: false, json: true })).exitCode).toBe(1);
});

test("cache maintenance runs on published analysis, warm headers stay stable and retained orphans mature", async () => {
  const { root } = await fixture(), cache = join(root, ".forge/repository"), path = join(cache, "snapshot.json");
  expect(existsSync(join(cache, "cache-gc.json"))).toBe(true);
  // First warm analysis updates observed reuse statistics, subsequent identical input is stable.
  await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  const header = readFileSync(path, "utf8"), snapshotId = readRepositorySnapshot(root)!.snapshotId;
  const text = '{"obsolete":true}', name = `${createHash("sha256").update(text).digest("hex")}.json`, unused = join(cache, "chunks", name);
  writeFileSync(unused, text);
  await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  expect(readFileSync(path, "utf8")).toBe(header); expect(existsSync(unused)).toBe(true);
  const now = Date.now(), time = spyOn(Date, "now").mockReturnValue(now + 24 * 3600000 + 5000);
  try {
    await analyzeRepository(root, manifest, { write: true, partitionCache: true });
    expect(existsSync(unused)).toBe(false); expect(readRepositorySnapshot(root)!.snapshotId).toBe(snapshotId);
    expect(readFileSync(path, "utf8")).toBe(header);
  } finally { time.mockRestore(); }
  expect(parseCli(["repository", "cache-gc", "--grace-hours", "1", "--json"]).errors).toEqual([]);
  expect(parseCli(["repository", "cache-gc", "--grace-hours", "0"]).errors.length).toBeGreaterThan(0);
  expect(parseCli(["repository", "cache-gc", "--snapshot-id", snapshotId, "--write"]).errors.length).toBeGreaterThan(0);
  expect((await runRepositoryCommand({ action: "cache-gc", cwd: root, root, write: true, json: true, snapshotId })).exitCode).toBe(1);
  expect((await runRepositoryCommand({ action: "cache-gc", cwd: root, root, write: false, json: true })).mode).toBe("dry-run");
});

test("warm publication repairs invalid creation metadata instead of preserving an unreadable generation", async () => {
  const { root } = await fixture(), path = join(root, ".forge/repository/snapshot.json");
  await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  const header = JSON.parse(readFileSync(path, "utf8")); header.header.createdAt = null; writeFileSync(path, JSON.stringify(header));
  expect(() => readRepositorySnapshot(root)).toThrow("invalid");
  await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  expect(readRepositorySnapshot(root)?.coverage.errors).toBe(0);
});
