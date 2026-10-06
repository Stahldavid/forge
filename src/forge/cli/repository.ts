import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readRepositoryManifest, resolveRepositoryRoot, validateRepositoryManifest } from "../repository-manifest/index.ts";
import { discoverRepository } from "../repository-analysis/scanner.ts";
import { analyzeRepository } from "../repository-analysis/analyze.ts";
import { readRepositorySnapshot, repositoryContext } from "../repository-analysis/context.ts";
import { evaluateRepositoryQuality } from "../repository-analysis/quality.ts";
import { isSensitiveRepositoryPath } from "../repository-analysis/scanner.ts";
import { collectRepositoryCache } from "../repository-analysis/cache-gc.ts";
import { createRepositoryAgentBenchmarkPlan, evaluateRepositoryAgentBenchmark, repositoryAgentBenchmarkBinding } from "../repository-analysis/benchmark.ts";
import { selectRepositoryChecks } from "../repository-analysis/check-selection.ts";
import { isDeepStrictEqual } from "node:util";
import { planRepositoryRuntime, observeRepositoryRuntime, readRuntimeObservation, selectRuntimeObservation, runtimeSourceDigest } from "../repository-analysis/runtime-observation.ts";

function readBenchmarkJson(cwd: string, input: string, maximum: number): any {
  const path = resolve(cwd, input);
  for (let current = path; ; current = dirname(current)) { if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("Benchmark inputs cannot traverse symlinks"); if (dirname(current) === current) break; }
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size > maximum || isSensitiveRepositoryPath(path)) throw new Error("Benchmark input must be a bounded regular JSON file");
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { throw new Error("Benchmark input must contain valid JSON"); }
}

export interface RepositoryCliOptions {
  action: "discover" | "analyze" | "context" | "quality" | "cache-gc" | "benchmark-plan" | "benchmark-report" | "runtime-plan" | "runtime-observe" | "runtime-context";
  cwd: string;
  root?: string;
  projectId?: string;
  manifestPath?: string;
  cacheRoot?: string;
  write: boolean;
  json: boolean;
  query?: string;
  snapshotId?: string;
  limit?: number;
  maxChars?: number;
  cursor?: string;
  output?: string;
  cases?: string;
  modelConfig?: string;
  repetitions?: number;
  plan?: string;
  observations?: string;
  graceHours?: number;
  execute?: boolean;
  environmentId?: string;
  observationId?: string;
}

export async function runRepositoryCommand(options: RepositoryCliOptions): Promise<{ exitCode: number; [key: string]: unknown }> {
  try {
    if (!["discover", "analyze", "context", "quality", "cache-gc", "benchmark-plan", "benchmark-report", "runtime-plan", "runtime-observe", "runtime-context"].includes(options.action)) throw new Error("Unsupported repository action");
    const runtime = options.action.startsWith("runtime-");
    if (!runtime && (options.execute || options.environmentId !== undefined || options.observationId !== undefined)) throw new Error("Runtime options require a runtime action");
    if (options.execute && options.action !== "runtime-observe") throw new Error("--execute requires runtime-observe");
    if (["runtime-plan", "runtime-observe"].includes(options.action) && !options.environmentId) throw new Error("Runtime planning/observation requires --environment-id <label>");
    if (options.action === "runtime-observe" && !options.execute) throw new Error("Runtime observation executes declared commands; review runtime-plan then supply --execute");
    if (["runtime-plan", "runtime-context"].includes(options.action) && options.write) throw new Error("Runtime plans/context are read-only");
    if (runtime && options.cacheRoot) throw new Error("Runtime reports use the repository-owned cache; --cache-root is unsupported");
    if (runtime && options.cursor) throw new Error("Runtime context does not support --cursor");
    if (runtime && options.maxChars !== undefined && options.maxChars > 16000) throw new Error("Runtime context is bounded to 16000 characters");
    if (runtime && options.limit !== undefined) throw new Error("Runtime actions do not support --limit");
    if (options.action !== "runtime-context" && runtime && options.query !== undefined) throw new Error("--query requires runtime-context for runtime actions");
    if (options.action === "runtime-context" && options.observationId) throw new Error("--observation-id requires runtime-plan or runtime-observe");
    if (["context", "quality", "benchmark-plan", "benchmark-report"].includes(options.action) && options.write) throw new Error("Repository context/quality/benchmark is read-only");
    if (["quality", "benchmark-plan"].includes(options.action) && !options.cases) throw new Error("Repository quality/benchmark-plan requires --cases <reviewed-cases.json>");
    if (!["quality", "benchmark-plan"].includes(options.action) && options.cases) throw new Error("--cases is only supported for quality/benchmark-plan");
    if (options.action === "benchmark-plan" && !options.modelConfig) throw new Error("Benchmark planning requires --model-config <file>");
    if (options.action !== "benchmark-plan" && (options.modelConfig || options.repetitions !== undefined)) throw new Error("Model options require benchmark-plan");
    if (options.action === "benchmark-report" && (!options.plan || !options.observations)) throw new Error("Benchmark reporting requires --plan and --observations");
    if (options.action !== "benchmark-report" && (options.plan || options.observations)) throw new Error("--plan/--observations require benchmark-report");
    if (options.action !== "cache-gc" && options.graceHours !== undefined) throw new Error("--grace-hours requires cache-gc");
    if (options.action === "cache-gc" && [options.query, options.snapshotId, options.limit, options.maxChars, options.cursor].some(value => value !== undefined)) throw new Error("cache-gc does not support context or snapshot guard options");
    if (options.output && (options.action !== "discover" || !options.write)) throw new Error("--output requires discovery with --write");
    const root = await resolveRepositoryRoot(options);
    if (options.action === "cache-gc") return { exitCode: 0, ok: true, ...collectRepositoryCache(root, { cacheRoot: options.cacheRoot, apply: options.write, graceMs: options.graceHours === undefined ? undefined : options.graceHours * 3600000 }) };
    if (options.action === "discover") {
      const manifest = discoverRepository(root);
      const checked = validateRepositoryManifest(manifest);
      if (!checked.manifest) throw new Error(`No valid supported repository proposal: ${checked.diagnostics.join("; ")}`);
      if (options.write) {
        const file = resolve(options.output ?? resolve(root, "forge.manifest.json"));
        if (existsSync(file)) throw new Error("Discovery never overwrites an existing manifest; choose a new --output");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      }
      return { exitCode: 0, ok: true, root, manifest, wroteManifest: options.write };
    }
    const loaded = readRepositoryManifest(root, { manifestPath: options.manifestPath });
    if (!loaded.manifest || loaded.diagnostics.length) throw new Error(loaded.diagnostics.join("; ") || "Repository manifest missing. Run forge manifest discover, review and save the proposal first.");
    if (options.action === "runtime-observe") {
      if (options.snapshotId) {
        const input = await analyzeRepository(root, loaded.manifest, { write: false });
        if (input.snapshotId !== options.snapshotId) throw new Error("Runtime snapshot guard differs from current source");
      }
      const report = await observeRepositoryRuntime(root, loaded.manifest, { environmentId: options.environmentId!, observationId: options.observationId, write: options.write });
      const ok = report.observations.every(item => item.status === "completed");
      return { ok, exitCode: ok ? 0 : 1, wroteArtifacts: options.write, report };
    }
    if (options.action === "runtime-plan") {
      const input = await analyzeRepository(root, loaded.manifest, { write: false });
      if (options.snapshotId && input.snapshotId !== options.snapshotId) throw new Error("Runtime snapshot guard differs from current source");
      return { ok: true, exitCode: 0, plan: { ...planRepositoryRuntime(input, options.environmentId!, options.observationId), inputDigest: runtimeSourceDigest(root, loaded.manifest) } };
    }
    if (options.action === "analyze") {
      const snapshot = await analyzeRepository(root, loaded.manifest, { write: options.write, cacheRoot: options.cacheRoot });
      const ok = snapshot.coverage.errors === 0;
      return { exitCode: ok ? 0 : 1, ok, root, wroteArtifacts: options.write, snapshotId: snapshot.snapshotId, coverage: snapshot.coverage, snapshot };
    }
    const snapshot = readRepositorySnapshot(root, { cacheRoot: options.cacheRoot });
    if (!snapshot) throw new Error("Repository snapshot missing; run forge repository analyze --write first");
    if (options.action === "runtime-context") {
      const current = repositoryContext(root, snapshot, "overview", { manifest: loaded.manifest, snapshotId: options.snapshotId });
      if (!current.ok) throw new Error(current.diagnostics.join("; "));
      const report = readRuntimeObservation(root, snapshot, { environmentId: options.environmentId });
      if (!report) throw new Error("Runtime report missing, stale or invalid; review runtime-plan and run runtime-observe explicitly");
      return { ok: true, exitCode: 0, context: selectRuntimeObservation(report, { query: options.query, maxChars: options.maxChars }) };
    }
    if (["quality", "benchmark-plan", "benchmark-report"].includes(options.action)) {
      const current = repositoryContext(root, snapshot, "overview", { manifest: loaded.manifest, snapshotId: options.snapshotId });
      if (!current.ok) throw new Error(current.diagnostics.join("; "));
      if (options.action === "benchmark-report") {
        const input = readBenchmarkJson(options.cwd, options.plan!, 128 * 1024 * 1024), plan = input.plan ?? input;
        const report = evaluateRepositoryAgentBenchmark(plan, readBenchmarkJson(options.cwd, options.observations!, 16 * 1024 * 1024));
        const expectedBinding = repositoryAgentBenchmarkBinding(snapshot);
        if (!isDeepStrictEqual(plan.binding, expectedBinding)) throw new Error("Benchmark plan belongs to a different repository input");
        const checksByScope = new Map<string, unknown>();
        for (const run of plan.runs) {
          const key = JSON.stringify(run.workerInput.scope);
          if (!checksByScope.has(key)) checksByScope.set(key, JSON.parse(JSON.stringify(selectRepositoryChecks(snapshot, { scope: run.workerInput.scope }).checks)));
          if (!isDeepStrictEqual(run.workerInput.checks, checksByScope.get(key))) throw new Error("Benchmark checks differ from current repository declarations");
        }
        return { ...report, ok: true, exitCode: 0 };
      }
      if (options.action === "benchmark-plan") {
        const plan = createRepositoryAgentBenchmarkPlan(snapshot, readBenchmarkJson(options.cwd, options.cases!, 128 * 1024), { model: readBenchmarkJson(options.cwd, options.modelConfig!, 128 * 1024), repetitions: options.repetitions, maxChars: options.maxChars });
        return { plan, ok: true, exitCode: 0 };
      }
      const casesPath = resolve(options.cwd, options.cases!);
      const stat = lstatSync(casesPath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024 || isSensitiveRepositoryPath(casesPath)) throw new Error("Quality cases must be a bounded regular JSON file");
      let cases: unknown;
      try { cases = JSON.parse(readFileSync(casesPath, "utf8")); } catch { throw new Error("Quality cases must contain valid JSON"); }
      const report = evaluateRepositoryQuality(snapshot, cases as Parameters<typeof evaluateRepositoryQuality>[1], { maxChars: options.maxChars });
      return { ...report, ok: report.passed, exitCode: report.passed ? 0 : 1 };
    }
    const result = repositoryContext(root, snapshot, options.query ?? "overview", {
      snapshotId: options.snapshotId, limit: options.limit, maxChars: options.maxChars, cursor: options.cursor, manifest: loaded.manifest,
    });
    return { ...result, exitCode: result.ok ? 0 : 1 };
  } catch (error) { return { exitCode: 1, ok: false, diagnostics: [{ severity: "error", code: "FORGE_REPOSITORY", message: (error instanceof Error ? error.message : "Repository operation failed").slice(0, 512) }] }; }
}
