import { mkdtempSync, rmSync } from "node:fs";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { availableParallelism, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { TestCost, TestGraph } from "../compiler/types/test-graph.ts";
import type {
  VerifyOptions,
  VerifyProfile,
  VerifyResult,
  VerifyStep,
  VerifyTestGraphDurationSource,
  VerifyTestGraphLane,
  VerifyTestGraphPlan,
  VerifyTestGraphPlanChunk,
} from "../compiler/types/cli.ts";
import {
  FORGE_VERIFY_POLICY,
  FORGE_VERIFY_SCRIPT_TIMEOUT,
} from "../compiler/diagnostics/codes.ts";
import { detectPackageManager } from "../compiler/package-manager/detect.ts";
import { resolveCommandArgv, resolvePackageManagerArgv } from "../compiler/package-manager/executor.ts";
import { runCheckCommand, runGenerateCommand } from "./commands.ts";
import { lintForgeGuards } from "./lint-forge.ts";
import { runPolicyCommand } from "./policy.ts";
import { runAuthCommand } from "./auth.ts";
import { runRlsCommand } from "./rls.ts";
import { buildImpactTestPlan, diagnosticsForImpactTestRun, runImpactTestPlan } from "../impact/index.ts";
import { runAgentCheck } from "../agent-adapters/index.ts";
import type { AgentAdapterTarget } from "../agent-adapters/types.ts";

interface PackageScripts {
  typecheck?: string;
  test?: string;
  lint?: string;
}

const DEFAULT_SCRIPT_TIMEOUT_MS = 30 * 60 * 1000;
type TypecheckerChoice = "tsc" | "tsgo" | "auto";

interface ScriptRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  durationMs: number;
  timedOut: boolean;
  spawnError?: boolean;
}

function readPackageScripts(workspaceRoot: string): PackageScripts {
  const packageJsonPath = join(workspaceRoot, "package.json");
  if (!nodeFileSystem.exists(packageJsonPath)) {
    return {};
  }

  try {
    const pkg = JSON.parse((nodeFileSystem.readText(packageJsonPath) ?? "")) as {
      scripts?: PackageScripts;
    };
    return pkg.scripts ?? {};
  } catch {
    return {};
  }
}

async function spawnPackageRun(
  workspaceRoot: string,
  scriptName: string,
  timeoutMs: number,
): Promise<ScriptRunResult> {
  const packageManager = detectPackageManager(workspaceRoot);
  let argv = resolvePackageManagerArgv([packageManager, "run", scriptName]);
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(argv[0] ?? "")) {
    argv = [process.env.ComSpec ?? "cmd.exe", "/d", "/c", packageManager, "run", scriptName];
  }
  return spawnArgv(workspaceRoot, argv, timeoutMs, argv.join(" "));
}

async function spawnArgv(
  workspaceRoot: string,
  argv: string[],
  timeoutMs: number,
  command = argv.join(" "),
  envOverrides?: Record<string, string>,
): Promise<ScriptRunResult> {
  const started = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(argv[0]!, argv.slice(1), {
        cwd: workspaceRoot,
        env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        command,
        durationMs: Date.now() - started,
        timedOut: false,
        spawnError: true,
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // Process may already have exited.
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: 1,
          stdout,
          stderr: error instanceof Error ? error.message : String(error),
          command,
          durationMs: Date.now() - started,
          timedOut,
          spawnError: true,
        });
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({
          exitCode: timedOut ? 1 : code ?? 1,
          stdout,
          stderr,
          command,
          durationMs: Date.now() - started,
          timedOut,
        });
      }
    });
  });
}

async function runPackageScript(
  workspaceRoot: string,
  scriptName: string,
  timeoutMs: number,
): Promise<ScriptRunResult> {
  return spawnPackageRun(workspaceRoot, scriptName, timeoutMs);
}

function skippedStep(name: string, reason: string): VerifyStep {
  return {
    name,
    ok: true,
    skipped: true,
    skipReason: reason,
  };
}

function firstFailureKind(results: Array<{ ok: boolean; timedOut?: boolean; failureKind?: string }>): string | undefined {
  return results.find((result) => !result.ok)?.failureKind;
}

function resolveScriptTimeoutMs(options: VerifyOptions): number {
  if (options.scriptTimeoutMs && Number.isFinite(options.scriptTimeoutMs)) {
    return options.scriptTimeoutMs;
  }
  const fromEnv = process.env.FORGE_VERIFY_SCRIPT_TIMEOUT_MS;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return DEFAULT_SCRIPT_TIMEOUT_MS;
}

function printProgress(options: VerifyOptions, message: string): void {
  if (!options.json) {
    console.error(message);
  }
}

function timedOutDiagnostic(scriptName: string, timeoutMs: number): Diagnostic {
  return createDiagnostic({
    severity: "error",
    code: FORGE_VERIFY_SCRIPT_TIMEOUT,
    message: `${scriptName} script timed out after ${timeoutMs}ms`,
    suggestedCommands: [
      `forge verify --skip-tests --skip-eslint --script-timeout-ms ${timeoutMs}`,
      "forge test plan --changed --json",
      "forge verify --changed",
    ],
  });
}

function outputExcerpt(stdout: string, stderr: string): string {
  const combined = [stderr.trim(), stdout.trim()].filter(Boolean).join("\n");
  if (!combined) {
    return "";
  }
  const normalized = combined.replace(/\s+/g, " ").trim();
  return normalized.length > 300 ? `${normalized.slice(0, 297)}...` : normalized;
}

function packageScriptFailureKind(result: { exitCode: number; timedOut?: boolean }): string | undefined {
  if (result.timedOut) {
    return "timeout";
  }
  return result.exitCode === 0 ? undefined : "script-failure";
}

function packageScriptFailureDiagnostic(
  scriptName: string,
  code: string,
  result: { exitCode: number; stdout: string; stderr: string; command: string },
): Diagnostic {
  const excerpt = outputExcerpt(result.stdout, result.stderr);
  return createDiagnostic({
    severity: "error",
    code,
    message: `${scriptName} script failed with exit code ${result.exitCode}`,
    fixHint: excerpt ? `Last output: ${excerpt}` : undefined,
    suggestedCommands: [
      result.command,
      `forge verify --skip-${scriptName === "test" ? "tests" : scriptName}`,
      "forge dev --once --json",
    ],
  });
}

function resolveTypechecker(options: VerifyOptions): TypecheckerChoice {
  if (options.typechecker) {
    return options.typechecker;
  }
  const fromEnv = process.env.FORGE_TYPECHECKER;
  return fromEnv === "tsgo" || fromEnv === "auto" || fromEnv === "tsc" ? fromEnv : "tsc";
}

async function runTscTypecheck(
  workspaceRoot: string,
  scripts: PackageScripts,
  timeoutMs: number,
): Promise<ScriptRunResult> {
  if (scripts.typecheck) {
    return runPackageScript(workspaceRoot, "typecheck", timeoutMs);
  }
  const argv = resolveCommandArgv(["tsc", "--noEmit"]);
  return spawnArgv(workspaceRoot, argv, timeoutMs, "tsc --noEmit");
}

async function runTsgoTypecheck(workspaceRoot: string, timeoutMs: number): Promise<ScriptRunResult> {
  const argv = resolveCommandArgv(["tsgo", "--noEmit"]);
  return spawnArgv(workspaceRoot, argv, timeoutMs, "tsgo --noEmit");
}

async function runPreferredTypecheck(
  options: VerifyOptions,
  scripts: PackageScripts,
  timeoutMs: number,
): Promise<{ result: ScriptRunResult; diagnostics: Diagnostic[]; label: string }> {
  const choice = resolveTypechecker(options);
  if (choice === "tsc") {
    return { result: await runTscTypecheck(options.workspaceRoot, scripts, timeoutMs), diagnostics: [], label: "tsc" };
  }

  const tsgo = await runTsgoTypecheck(options.workspaceRoot, timeoutMs);
  if (tsgo.exitCode === 0) {
    return { result: tsgo, diagnostics: [], label: "tsgo" };
  }

  const fallback = await runTscTypecheck(options.workspaceRoot, scripts, timeoutMs);
  const diagnostics = [
    createDiagnostic({
      severity: "warning",
      code: "FORGE_VERIFY_TSGO_FALLBACK",
      message: `tsgo typecheck failed; fell back to tsc (${tsgo.spawnError ? "command unavailable" : `exit code ${tsgo.exitCode}`})`,
      fixHint: outputExcerpt(tsgo.stdout, tsgo.stderr) || undefined,
      suggestedCommands: [
        "npm install -D @typescript/native-preview@beta",
        "forge verify --typechecker tsc",
      ],
    }),
  ];
  return {
    result: fallback,
    diagnostics,
    label: choice === "auto" ? "auto->tsc" : "tsgo->tsc",
  };
}

const STRICT_TEST_COSTS: TestCost[] = ["instant", "fast", "standard", "slow"];
const STRICT_TEST_CHUNK_SIZE = 12;
const STRICT_TEST_MAX_DEFAULT_JOBS = 6;
// The isolated lane (one heavy file per chunk: node-compat, dev-server, CLI) is
// the makespan bottleneck, so it gets more default concurrency than before. The
// overall budget is still capped by STRICT_TEST_MAX_DEFAULT_JOBS and CPU count.
const STRICT_ISOLATED_TEST_MAX_DEFAULT_JOBS = 4;
const TESTGRAPH_PROFILE_RELATIVE_PATH = ".forge/test-runs/testgraph-profile.json";
const TEST_COST_FALLBACK_MS: Record<TestCost, number> = {
  instant: 250,
  fast: 1_000,
  standard: 3_000,
  slow: 12_000,
  docker: 60_000,
  browser: 60_000,
};
const TEST_COST_RANK: Record<TestCost, number> = {
  instant: 0,
  fast: 1,
  standard: 2,
  slow: 3,
  docker: 4,
  browser: 5,
};
const STRICT_TEST_FALLBACK_MS_BY_PATH: Array<{ pattern: RegExp; estimatedMs: number }> = [
  { pattern: /^tests\/cli\/node-compat\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/cli\/node-compat-dev-server\.test\.ts$/, estimatedMs: 6_000 },
  { pattern: /^tests\/cli\/node-compat-new\.test\.ts$/, estimatedMs: 8_000 },
  { pattern: /^tests\/cli\/cli\.test\.ts$/, estimatedMs: 3_000 },
  { pattern: /^tests\/cli\/cli-generation\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/cli\/cli-verify\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/cli\/cli-verify-changed\.test\.ts$/, estimatedMs: 5_000 },
  { pattern: /^tests\/db\/pglite-adapter\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/dev\/dev-workflow-worker\.test\.ts$/, estimatedMs: 6_000 },
  { pattern: /^tests\/external-manifest\/external-runtime-bridge\.test\.ts$/, estimatedMs: 4_000 },
  { pattern: /^tests\/external-manifest\/external-runtime-cli\.test\.ts$/, estimatedMs: 6_000 },
  { pattern: /^tests\/external-manifest\/external-runtime-node-cli\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/external-manifest\/go-adapter-conformance\.test\.ts$/, estimatedMs: 5_000 },
  { pattern: /^tests\/external-manifest\/java-adapter-conformance\.test\.ts$/, estimatedMs: 20_000 },
  { pattern: /^tests\/impact\/h28-impact\.test\.ts$/, estimatedMs: 8_000 },
  { pattern: /^tests\/impact\/h28-impact-runner\.test\.ts$/, estimatedMs: 7_000 },
  { pattern: /^tests\/impact\/h28-impact-runner-diagnostics\.test\.ts$/, estimatedMs: 3_000 },
  { pattern: /^tests\/refactor\/h27-refactor\.test\.ts$/, estimatedMs: 6_000 },
  { pattern: /^tests\/refactor\/h27-refactor-extract-action-apply\.test\.ts$/, estimatedMs: 10_000 },
  { pattern: /^tests\/refactor\/h27-refactor-extract-action\.test\.ts$/, estimatedMs: 21_000 },
  { pattern: /^tests\/refactor\/h27-refactor-extract-action-bindings\.test\.ts$/, estimatedMs: 10_000 },
  { pattern: /^tests\/release\/h23-release-artifacts\.test\.ts$/, estimatedMs: 8_000 },
  { pattern: /^tests\/release\/h23-release-self-host\.test\.ts$/, estimatedMs: 4_000 },
  { pattern: /^tests\/release\/h23-release\.test\.ts$/, estimatedMs: 3_000 },
  { pattern: /^tests\/templates\/new-b2b-support-web\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/templates\/new-agent-workroom\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/templates\/new-minimal-web\.test\.ts$/, estimatedMs: 12_000 },
  { pattern: /^tests\/templates\/create-forge-app\.test\.ts$/, estimatedMs: 8_000 },
];
const STRICT_ISOLATED_TEST_PATTERNS = [
  /^tests\/ai\//,
  /^tests\/cli\/cli-generation\.test\.ts$/,
  /^tests\/cli\/cli\.test\.ts$/,
  /^tests\/cli\/cli-verify\.test\.ts$/,
  /^tests\/cli\/cli-verify-changed\.test\.ts$/,
  /^tests\/cli\/node-compat-dev-server\.test\.ts$/,
  /^tests\/cli\/node-compat-new\.test\.ts$/,
  /^tests\/cli\/windows\.test\.ts$/,
  /^tests\/client\//,
  /^tests\/db\/pglite-adapter\.test\.ts$/,
  /^tests\/dev\//,
  /^tests\/external-manifest\/external-manifest\.test\.ts$/,
  /^tests\/external-manifest\/go-adapter-conformance\.test\.ts$/,
  /^tests\/external-manifest\/java-adapter-conformance\.test\.ts$/,
  /^tests\/external-manifest\/external-runtime-bridge\.test\.ts$/,
  /^tests\/external-manifest\/external-runtime-node-cli\.test\.ts$/,
  /^tests\/impact\/h28-impact\.test\.ts$/,
  /^tests\/impact\/h28-impact-runner\.test\.ts$/,
  /^tests\/impact\/h28-impact-runner-diagnostics\.test\.ts$/,
  /^tests\/live\//,
  /^tests\/queries\/query-dev-server\.test\.ts$/,
  // refactor extract-action/rename tests use ts.createProgram fresh per call
  // against isolated temp workspaces (no shared global or server state), so they
  // run safely co-located in the parallel lane and share one process warm-up
  // instead of paying a cold start per isolated chunk.
  /^tests\/release\/h23-release-artifacts\.test\.ts$/,
  /^tests\/release\/h23-release-self-host\.test\.ts$/,
  /^tests\/release\/h23-release\.test\.ts$/,
  /^tests\/security\/tenant-isolation\/http-runtime\.test\.ts$/,
  /^tests\/templates\/new-b2b-support-web\.test\.ts$/,
  /^tests\/templates\/new-agent-workroom\.test\.ts$/,
  /^tests\/templates\/new-minimal-web\.test\.ts$/,
  /^tests\/telemetry\/telemetry-dev-server\.test\.ts$/,
];
const STRICT_SERIAL_TEST_PATTERNS: RegExp[] = [];

interface StrictTestEntry {
  file: string;
  cost: TestCost;
  lane: StrictTestLane;
  estimatedMs: number;
  durationSource: VerifyTestGraphDurationSource;
}

interface TestGraphProfileFile {
  schemaVersion: "0.1.0";
  updatedAt: string;
  files: Record<string, {
    durationMs: number;
    runs: number;
    lane: StrictTestLane;
    sourceHash?: string;
    lastExitCode: number;
    lastRunAt: string;
  }>;
}

function readTestGraph(workspaceRoot: string): TestGraph | null {
  const raw = nodeFileSystem.readText(join(workspaceRoot, "src/forge/_generated/testGraph.json"));
  if (!raw) {
    return null;
  }
  return JSON.parse(stripDeterministicHeader(raw)) as TestGraph;
}

function strictTestEntries(workspaceRoot: string): Array<{ file: string; cost: TestCost }> {
  const graph = readTestGraph(workspaceRoot);
  if (!graph) {
    return [];
  }
  const byFile = new Map<string, TestCost>();
  for (const test of graph.tests) {
    if (!STRICT_TEST_COSTS.includes(test.cost)) {
      continue;
    }
    const existing = byFile.get(test.file);
    if (!existing || TEST_COST_RANK[test.cost] > TEST_COST_RANK[existing]) {
      byFile.set(test.file, test.cost);
    }
  }
  return [...byFile.entries()]
    .map(([file, cost]) => ({ file, cost }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

export function chunkFiles(files: string[], size: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

export function resolveStrictTestJobs(options: {
  requested?: number;
  env?: NodeJS.ProcessEnv;
  chunkCount: number;
}): number {
  if (options.chunkCount <= 1) {
    return 1;
  }
  const fromEnv = options.env?.FORGE_VERIFY_TEST_JOBS;
  const parsedEnv = fromEnv ? Number(fromEnv) : undefined;
  const requested = options.requested ?? parsedEnv;
  if (requested !== undefined && Number.isInteger(requested) && requested >= 1) {
    return Math.min(requested, options.chunkCount);
  }

  const cpuBound = Math.max(2, Math.floor(availableParallelism() / 2));
  return Math.min(STRICT_TEST_MAX_DEFAULT_JOBS, cpuBound, options.chunkCount);
}

function resolveStrictLaneJobs(options: {
  totalJobs: number;
  parallelChunkCount: number;
  isolatedChunkCount: number;
  env?: NodeJS.ProcessEnv;
}): { parallelJobs: number; isolatedJobs: number } {
  if (options.parallelChunkCount === 0) {
    return {
      parallelJobs: 0,
      isolatedJobs: resolveStrictIsolatedTestJobs({
        env: options.env,
        chunkCount: Math.min(options.totalJobs, options.isolatedChunkCount),
      }),
    };
  }
  if (options.isolatedChunkCount === 0) {
    return {
      parallelJobs: Math.min(options.totalJobs, options.parallelChunkCount),
      isolatedJobs: 0,
    };
  }
  const requestedIsolated = resolveStrictIsolatedTestJobs({
    env: options.env,
    chunkCount: options.isolatedChunkCount,
  });
  const isolatedJobs = Math.min(
    requestedIsolated,
    options.isolatedChunkCount,
    Math.max(1, options.totalJobs - 1),
  );
  const parallelJobs = Math.min(
    options.parallelChunkCount,
    Math.max(1, options.totalJobs - isolatedJobs),
  );
  return { parallelJobs, isolatedJobs };
}

export function resolveStrictIsolatedTestJobs(options: {
  requested?: number;
  env?: NodeJS.ProcessEnv;
  chunkCount: number;
}): number {
  if (options.chunkCount <= 1) {
    return 1;
  }
  const fromEnv = options.env?.FORGE_VERIFY_ISOLATED_TEST_JOBS;
  const parsedEnv = fromEnv ? Number(fromEnv) : undefined;
  const requested = options.requested ?? parsedEnv;
  if (requested !== undefined && Number.isInteger(requested) && requested >= 1) {
    return Math.min(requested, options.chunkCount);
  }
  return Math.min(STRICT_ISOLATED_TEST_MAX_DEFAULT_JOBS, options.chunkCount);
}

function normalizeTestPath(file: string): string {
  return file.replace(/\\/g, "/");
}

export type StrictTestLane = VerifyTestGraphLane;

export function classifyStrictTestFile(file: string): StrictTestLane {
  const normalized = normalizeTestPath(file);
  if (STRICT_SERIAL_TEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "serial";
  }
  if (STRICT_ISOLATED_TEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "isolated";
  }
  return "parallel";
}

function testGraphProfilePath(workspaceRoot: string): string {
  return join(workspaceRoot, TESTGRAPH_PROFILE_RELATIVE_PATH);
}

function testFileSourceHash(workspaceRoot: string, file: string): string | null {
  const source = nodeFileSystem.readText(join(workspaceRoot, file));
  if (source === null) {
    return null;
  }
  return createHash("sha256")
    .update(normalizeTestPath(file))
    .update("\0")
    .update(source)
    .digest("hex")
    .slice(0, 16);
}

function readTestGraphProfile(workspaceRoot: string): TestGraphProfileFile | null {
  const raw = nodeFileSystem.readText(testGraphProfilePath(workspaceRoot));
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as TestGraphProfileFile;
    if (parsed.schemaVersion !== "0.1.0" || typeof parsed.files !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function estimateStrictTestEntry(
  workspaceRoot: string,
  file: string,
  cost: TestCost,
  lane: StrictTestLane,
  profile: TestGraphProfileFile | null,
): { estimatedMs: number; source: VerifyTestGraphDurationSource } {
  const profiled = profile?.files[file];
  const sourceHash = testFileSourceHash(workspaceRoot, file);
  if (
    profiled &&
    sourceHash !== null &&
    profiled.sourceHash === sourceHash &&
    Number.isFinite(profiled.durationMs) &&
    profiled.durationMs > 0
  ) {
    return { estimatedMs: Math.max(1, Math.round(profiled.durationMs)), source: "profile" };
  }
  const normalized = normalizeTestPath(file);
  const pathOverride = STRICT_TEST_FALLBACK_MS_BY_PATH.find((entry) => entry.pattern.test(normalized));
  const fallback = pathOverride?.estimatedMs ?? TEST_COST_FALLBACK_MS[cost] ?? TEST_COST_FALLBACK_MS.standard;
  if (lane === "serial") {
    return { estimatedMs: Math.max(fallback, 8_000), source: "fallback" };
  }
  if (lane === "isolated") {
    return { estimatedMs: Math.max(fallback, 3_000), source: "fallback" };
  }
  return { estimatedMs: fallback, source: "fallback" };
}

function weightedStrictTestEntries(
  workspaceRoot: string,
  profile: TestGraphProfileFile | null,
): StrictTestEntry[] {
  return strictTestEntries(workspaceRoot).map(({ file, cost }) => {
    const lane = classifyStrictTestFile(file);
    const estimate = estimateStrictTestEntry(workspaceRoot, file, cost, lane, profile);
    return {
      file,
      cost,
      lane,
      estimatedMs: estimate.estimatedMs,
      durationSource: estimate.source,
    };
  });
}

function partitionStrictTestEntries(entries: StrictTestEntry[]): {
  parallel: StrictTestEntry[];
  isolated: StrictTestEntry[];
  serial: StrictTestEntry[];
} {
  const parallel: StrictTestEntry[] = [];
  const isolated: StrictTestEntry[] = [];
  const serial: StrictTestEntry[] = [];
  for (const entry of entries) {
    const lane = entry.lane;
    if (lane === "serial") {
      serial.push(entry);
      continue;
    }
    if (lane === "isolated") {
      isolated.push(entry);
      continue;
    }
    parallel.push(entry);
  }
  return { parallel, isolated, serial };
}

export function packWeightedStrictTestChunks(
  entries: Array<{ file: string; estimatedMs: number; durationSource: VerifyTestGraphDurationSource }>,
  size: number,
): Array<{ files: string[]; estimatedMs: number; durationSource: VerifyTestGraphDurationSource }> {
  if (entries.length === 0) {
    return [];
  }
  const binCount = Math.max(1, Math.ceil(entries.length / Math.max(1, size)));
  const bins = Array.from({ length: binCount }, () => ({
    files: [] as string[],
    estimatedMs: 0,
    durationSource: "profile" as VerifyTestGraphDurationSource,
  }));
  const ordered = [...entries].sort((left, right) => {
    const byEstimate = right.estimatedMs - left.estimatedMs;
    return byEstimate !== 0 ? byEstimate : left.file.localeCompare(right.file);
  });
  for (const entry of ordered) {
    const target = bins
      .filter((bin) => bin.files.length < size)
      .sort((left, right) => {
        const byEstimate = left.estimatedMs - right.estimatedMs;
        return byEstimate !== 0 ? byEstimate : left.files.length - right.files.length;
      })[0] ?? bins[0]!;
    target.files.push(entry.file);
    target.files.sort();
    target.estimatedMs += entry.estimatedMs;
    if (entry.durationSource === "fallback") {
      target.durationSource = "fallback";
    }
  }
  return bins.filter((bin) => bin.files.length > 0);
}

function oneFileChunks(
  entries: StrictTestEntry[],
): Array<{ files: string[]; estimatedMs: number; durationSource: VerifyTestGraphDurationSource }> {
  return [...entries]
    .sort((left, right) => {
      const byEstimate = right.estimatedMs - left.estimatedMs;
      return byEstimate !== 0 ? byEstimate : left.file.localeCompare(right.file);
    })
    .map((entry) => ({
      files: [entry.file],
      estimatedMs: entry.estimatedMs,
      durationSource: entry.durationSource,
    }));
}

function laneEstimate(chunks: VerifyTestGraphPlanChunk[], jobs: number): number {
  const workers = Array.from({ length: Math.max(1, jobs) }, () => 0);
  for (const chunk of chunks) {
    workers.sort((left, right) => left - right);
    workers[0] += chunk.estimatedMs;
  }
  return Math.max(...workers, 0);
}

function strictPlanRecommendations(plan: VerifyTestGraphPlan): string[] {
  const recommendations: string[] = [];
  if (!plan.profileFound) {
    recommendations.push(`Run forge verify --strict once to create ${TESTGRAPH_PROFILE_RELATIVE_PATH}; later plans use measured durations.`);
  }
  if (plan.lanes.serial.chunkCount > 0 && plan.lanes.serial.estimatedMs > plan.criticalPathEstimateMs * 0.35) {
    recommendations.push("Split or de-globalize the slowest serial tests; serial work is now the main critical-path limiter.");
  } else if (plan.lanes.serial.chunkCount === 0 && plan.lanes.isolated.chunkCount > 0) {
    recommendations.push("No current strict TestGraph files require the serial lane; optimize isolated runtime/template tests next.");
  }
  if (plan.lanes.isolated.chunkCount > 0 && plan.isolatedJobs < STRICT_ISOLATED_TEST_MAX_DEFAULT_JOBS) {
    recommendations.push(`Set FORGE_VERIFY_ISOLATED_TEST_JOBS=${STRICT_ISOLATED_TEST_MAX_DEFAULT_JOBS} on machines that can run isolated runtime tests concurrently.`);
  }
  const slowest = plan.slowestFiles[0];
  if (slowest) {
    recommendations.push(`Inspect ${slowest.file}; it is currently the heaviest estimated TestGraph file.`);
  }
  return recommendations;
}

export function buildStrictTestGraphPlan(
  workspaceRoot: string,
  testJobs?: number,
  env: NodeJS.ProcessEnv = process.env,
): VerifyTestGraphPlan {
  const profile = readTestGraphProfile(workspaceRoot);
  const entries = weightedStrictTestEntries(workspaceRoot, profile);
  const partitioned = partitionStrictTestEntries(entries);
  const parallelRaw = packWeightedStrictTestChunks(partitioned.parallel, STRICT_TEST_CHUNK_SIZE);
  const isolatedRaw = oneFileChunks(partitioned.isolated);
  const serialRaw = oneFileChunks(partitioned.serial);
  const totalJobs = resolveStrictTestJobs({
    requested: testJobs,
    env,
    chunkCount: parallelRaw.length + isolatedRaw.length,
  });
  const { parallelJobs, isolatedJobs } = resolveStrictLaneJobs({
    totalJobs,
    parallelChunkCount: parallelRaw.length,
    isolatedChunkCount: isolatedRaw.length,
    env,
  });
  let index = 1;
  const toPlanChunks = (
    lane: StrictTestLane,
    chunks: Array<{ files: string[]; estimatedMs: number; durationSource: VerifyTestGraphDurationSource }>,
  ): VerifyTestGraphPlanChunk[] => chunks.map((chunk) => ({
    index: index++,
    lane,
    files: chunk.files,
    estimatedMs: chunk.estimatedMs,
    durationSource: chunk.durationSource,
  }));
  const parallelChunks = toPlanChunks("parallel", parallelRaw);
  const isolatedChunks = toPlanChunks("isolated", isolatedRaw);
  const serialChunks = toPlanChunks("serial", serialRaw);
  const laneMode =
    totalJobs <= 1 && parallelChunks.length > 0 && isolatedChunks.length > 0
      ? "sequential"
      : "overlap";
  const chunks = [...parallelChunks, ...isolatedChunks, ...serialChunks];
  const lanes = {
    parallel: {
      fileCount: partitioned.parallel.length,
      chunkCount: parallelChunks.length,
      estimatedMs: parallelChunks.reduce((sum, chunk) => sum + chunk.estimatedMs, 0),
    },
    isolated: {
      fileCount: partitioned.isolated.length,
      chunkCount: isolatedChunks.length,
      estimatedMs: isolatedChunks.reduce((sum, chunk) => sum + chunk.estimatedMs, 0),
    },
    serial: {
      fileCount: partitioned.serial.length,
      chunkCount: serialChunks.length,
      estimatedMs: serialChunks.reduce((sum, chunk) => sum + chunk.estimatedMs, 0),
    },
  };
  const plan: VerifyTestGraphPlan = {
    schemaVersion: "0.1.0",
    fileCount: entries.length,
    chunkCount: chunks.length,
    totalJobs,
    laneMode,
    jobs: parallelJobs,
    isolatedJobs,
    lanes,
    chunks,
    criticalPathEstimateMs:
      (laneMode === "sequential"
        ? laneEstimate(parallelChunks, parallelJobs) + laneEstimate(isolatedChunks, isolatedJobs)
        : Math.max(
          laneEstimate(parallelChunks, parallelJobs),
          laneEstimate(isolatedChunks, isolatedJobs),
        )) +
      lanes.serial.estimatedMs,
    profilePath: TESTGRAPH_PROFILE_RELATIVE_PATH,
    profileFound: profile !== null,
    slowestFiles: [...entries]
      .sort((left, right) => {
        const byEstimate = right.estimatedMs - left.estimatedMs;
        return byEstimate !== 0 ? byEstimate : left.file.localeCompare(right.file);
      })
      .slice(0, 10)
      .map((entry) => ({
        file: entry.file,
        lane: entry.lane,
        estimatedMs: entry.estimatedMs,
        source: entry.durationSource,
      })),
    recommendations: [],
  };
  plan.recommendations = strictPlanRecommendations(plan);
  return plan;
}

async function runStrictGraphChunkPool(
  workspaceRoot: string,
  chunks: VerifyTestGraphPlanChunk[],
  timeoutMs: number,
  jobs: number,
  totalChunks = chunks.length,
): Promise<{ results: Array<(ScriptRunResult & { files: string[]; lane: StrictTestLane }) | undefined>; timedOut: boolean }> {
  const results: Array<(ScriptRunResult & { files: string[]; lane: StrictTestLane }) | undefined> = [];
  let nextChunk = 0;
  let stopScheduling = false;

  async function runNextChunk(): Promise<void> {
    while (!stopScheduling) {
      const chunkIndex = nextChunk;
      nextChunk += 1;
      const chunk = chunks[chunkIndex];
      if (!chunk) {
        return;
      }
      const result = await runStrictGraphTestChunk(
        workspaceRoot,
        chunk.files,
        chunk.index - 1,
        totalChunks,
        timeoutMs,
      );
      results[chunkIndex] = { ...result, files: chunk.files, lane: chunk.lane };
      if (result.exitCode !== 0) {
        stopScheduling = true;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: jobs }, () => runNextChunk()));
  return {
    results,
    timedOut: results.some((result) => result?.timedOut),
  };
}

function writeTestGraphProfile(
  workspaceRoot: string,
  results: Array<(ScriptRunResult & { files: string[]; lane: StrictTestLane }) | undefined>,
): void {
  const existing = readTestGraphProfile(workspaceRoot);
  const now = new Date().toISOString();
  const files = { ...(existing?.files ?? {}) };
  for (const result of results) {
    if (!result || result.files.length === 0) {
      continue;
    }
    const perFileDuration = Math.max(1, Math.round(result.durationMs / result.files.length));
    for (const file of result.files) {
      const previous = files[file];
      files[file] = {
        durationMs: perFileDuration,
        runs: (previous?.runs ?? 0) + 1,
        lane: result.lane,
        sourceHash: testFileSourceHash(workspaceRoot, file) ?? previous?.sourceHash,
        lastExitCode: result.exitCode,
        lastRunAt: now,
      };
    }
  }
  const profile: TestGraphProfileFile = {
    schemaVersion: "0.1.0",
    updatedAt: now,
    files,
  };
  const path = testGraphProfilePath(workspaceRoot);
  nodeFileSystem.mkdirp(dirname(path));
  nodeFileSystem.writeText(path, `${JSON.stringify(profile, null, 2)}\n`);
}

async function runStrictGraphTests(
  workspaceRoot: string,
  timeoutMs: number,
  testJobs?: number,
): Promise<ScriptRunResult & { fileCount: number; chunkCount: number; jobs: number; isolatedJobs: number; plan: VerifyTestGraphPlan }> {
  const plan = buildStrictTestGraphPlan(workspaceRoot, testJobs);
  if (plan.fileCount === 0) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "TestGraph has no non-docker/browser tests",
      command: "forge strict TestGraph tests",
      durationMs: 0,
      timedOut: false,
      spawnError: true,
      fileCount: 0,
      chunkCount: 0,
      jobs: 0,
      isolatedJobs: 0,
      plan,
    };
  }

  const started = Date.now();
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let exitCode = 0;
  let failedOutput: Pick<ScriptRunResult, "stdout" | "stderr"> | null = null;
  const parallelChunks = plan.chunks.filter((chunk) => chunk.lane === "parallel");
  const isolatedChunks = plan.chunks.filter((chunk) => chunk.lane === "isolated");
  const serialChunks = plan.chunks.filter((chunk) => chunk.lane === "serial");

  let command = `bun test <${plan.fileCount} TestGraph files in ${plan.chunkCount} chunks, ${plan.laneMode} lanes, total jobs ${plan.totalJobs}, parallel jobs ${plan.jobs}, isolated jobs ${plan.isolatedJobs}, isolated ${isolatedChunks.length}, serial ${serialChunks.length}> --timeout ${timeoutMs}`;
  const parallelPool = () => runStrictGraphChunkPool(
    workspaceRoot,
    parallelChunks,
    timeoutMs,
    plan.jobs,
    plan.chunkCount,
  );
  const isolatedPool = () => runStrictGraphChunkPool(
    workspaceRoot,
    isolatedChunks,
    timeoutMs,
    plan.isolatedJobs,
    plan.chunkCount,
  );
  const [parallelRun, isolatedRun] = plan.laneMode === "sequential"
    ? [await parallelPool(), await isolatedPool()]
    : await Promise.all([parallelPool(), isolatedPool()]);
  const orderedResults: Array<(ScriptRunResult & { files: string[]; lane: StrictTestLane }) | undefined> = [];
  for (const result of parallelRun.results) {
    if (result) {
      orderedResults.push(result);
    }
  }
  for (const result of isolatedRun.results) {
    if (result) {
      orderedResults.push(result);
    }
  }
  timedOut = timedOut || parallelRun.timedOut;
  timedOut = timedOut || isolatedRun.timedOut;

  if (
    parallelRun.results.every((result) => result?.exitCode === 0) &&
    isolatedRun.results.every((result) => result?.exitCode === 0)
  ) {
    for (const chunk of serialChunks) {
      const result = await runStrictGraphTestChunk(
        workspaceRoot,
        chunk.files,
        chunk.index - 1,
        plan.chunkCount,
        timeoutMs,
      );
      orderedResults.push({ ...result, files: chunk.files, lane: chunk.lane });
      timedOut = timedOut || result.timedOut;
      if (result.exitCode !== 0) {
        break;
      }
    }
  }

  writeTestGraphProfile(workspaceRoot, orderedResults);

  for (const result of orderedResults) {
    if (!result) {
      continue;
    }
    stdout += result.stdout;
    stderr += result.stderr;
    timedOut = timedOut || result.timedOut;
    if (result.exitCode !== 0) {
      exitCode = result.exitCode;
      command = result.command;
      failedOutput = { stdout: result.stdout, stderr: result.stderr };
      break;
    }
  }

  return {
    exitCode,
    stdout: failedOutput?.stdout ?? stdout,
    stderr: failedOutput?.stderr ?? stderr,
    command,
    durationMs: Date.now() - started,
    timedOut,
    fileCount: plan.fileCount,
    chunkCount: plan.chunkCount,
    jobs: plan.jobs,
    isolatedJobs: plan.isolatedJobs,
    plan,
  };
}

function runStrictGraphTestChunk(
  workspaceRoot: string,
  chunk: string[],
  chunkIndex: number,
  chunkCount: number,
  timeoutMs: number,
): Promise<ScriptRunResult> {
  const argv = resolveCommandArgv(["bun", "test", ...chunk, "--timeout", String(timeoutMs)]);
  const chunkCommand = `bun test <TestGraph chunk ${chunkIndex + 1}/${chunkCount}, ${chunk.length} files> --timeout ${timeoutMs}`;
  const chunkTempDir = mkdtempSync(join(tmpdir(), `forge-testgraph-${chunkIndex + 1}-`));
  return spawnArgv(workspaceRoot, argv, timeoutMs, chunkCommand, {
    TMP: chunkTempDir,
    TEMP: chunkTempDir,
    TMPDIR: chunkTempDir,
    FORGE_TEST_TMPDIR: chunkTempDir,
    FORGE_VERIFY_CHUNK_INDEX: String(chunkIndex + 1),
    FORGE_VERIFY_CHUNK_COUNT: String(chunkCount),
    FORGE_DEV_PORT: "0",
  }).finally(() => {
    rmSync(chunkTempDir, { recursive: true, force: true });
  });
}

function resolveVerifyProfile(options: VerifyOptions): VerifyProfile {
  if (options.changed) {
    return "changed";
  }
  if (options.fast || options.smoke) {
    return "smoke";
  }
  if (options.strict) {
    return "strict";
  }
  if (options.standard) {
    return "standard";
  }
  return "default";
}

async function runStandardImpactTests(
  options: VerifyOptions,
): Promise<{ steps: VerifyStep[]; diagnostics: Diagnostic[] }> {
  const started = Date.now();
  const diagnostics: Diagnostic[] = [];
  const steps: VerifyStep[] = [];
  const plan = buildImpactTestPlan({
    subcommand: "run",
    workspaceRoot: options.workspaceRoot,
    json: options.json,
    write: false,
    changed: true,
    staged: false,
    maxCost: "standard",
    includeDocker: false,
    includeBrowser: false,
    bail: false,
  });
  const impactOnlyPlan = {
    ...plan,
    requiredChecks: [],
  };
  const commands = impactOnlyPlan.tests.map((test) => test.command);

  if (commands.length === 0) {
    steps.push(skippedStep("impact-tests", "no changed files selected an impact test"));
    return { steps, diagnostics };
  }

  const record = await runImpactTestPlan(options.workspaceRoot, impactOnlyPlan, {
    bail: false,
    timeoutMs: resolveScriptTimeoutMs(options),
  });
  steps.push({
    name: "impact-tests",
    ok: record.failed.length === 0,
    exitCode: record.failed.length === 0 ? 0 : 1,
    command: "forge test run --changed --max-cost standard --json",
    durationMs: Date.now() - started,
    timedOut: record.results.some((result) => result.timedOut),
    failureKind: firstFailureKind(record.results),
  });
  if (record.failed.length > 0) {
    diagnostics.push(...diagnosticsForImpactTestRun(record));
    diagnostics.push(
      createDiagnostic({
        severity: "error",
        code: "FORGE_VERIFY_TESTS",
        message: `impact-selected tests failed: ${record.failed.join(", ")}; inspect .forge/test-runs/last.json for command output`,
        suggestedCommands: [
          "forge test run --changed --max-cost standard --json",
          "forge repair diagnose --from-last-test-run --json",
          "forge verify --strict",
        ],
      }),
    );
  }
  return { steps, diagnostics };
}

export function configuredAgentTargets(workspaceRoot: string): AgentAdapterTarget[] {
  const targets: AgentAdapterTarget[] = [];
  if (nodeFileSystem.exists(join(workspaceRoot, ".forge/agent/context.json"))) {
    targets.push("generic");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, ".codex"))) {
    targets.push("codex");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, ".cursor"))) {
    targets.push("cursor");
  }
  if (nodeFileSystem.exists(join(workspaceRoot, "CLAUDE.md")) || nodeFileSystem.exists(join(workspaceRoot, ".claude"))) {
    targets.push("claude");
  }
  return targets;
}

export async function runVerifyCommand(
  options: VerifyOptions,
): Promise<VerifyResult> {
  const started = Date.now();
  const steps: VerifyStep[] = [];
  const diagnostics: Diagnostic[] = [];
  const scripts = readPackageScripts(options.workspaceRoot);
  const scriptTimeoutMs = resolveScriptTimeoutMs(options);
  const profile = resolveVerifyProfile(options);
  let testGraphPlan: VerifyTestGraphPlan | undefined;

  if (options.testPlan) {
    testGraphPlan = buildStrictTestGraphPlan(options.workspaceRoot, options.testJobs);
    steps.push({
      name: "tests:testgraph-plan",
      ok: testGraphPlan.fileCount > 0,
      skipped: false,
      exitCode: testGraphPlan.fileCount > 0 ? 0 : 1,
      command: `forge verify --strict --test-plan (${testGraphPlan.fileCount} files, ${testGraphPlan.chunkCount} chunks)`,
      durationMs: Date.now() - started,
    });
    if (testGraphPlan.fileCount === 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_VERIFY_TESTGRAPH_EMPTY",
          message: "TestGraph has no non-docker/browser tests",
        }),
      );
    }
    const ok = steps.every((step) => step.ok);
    return {
      ok,
      profile,
      steps,
      diagnostics,
      testGraphPlan,
      durationMs: Date.now() - started,
      exitCode: ok ? 0 : 1,
    };
  }

  if (options.changed) {
    const plan = buildImpactTestPlan({
      subcommand: "run",
      workspaceRoot: options.workspaceRoot,
      json: options.json,
      write: false,
      changed: true,
      staged: false,
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
    });
    const record = await runImpactTestPlan(options.workspaceRoot, plan, {
      bail: false,
      timeoutMs: scriptTimeoutMs,
    });
    for (const result of record.results) {
      steps.push({
        name: result.command,
        ok: result.ok,
        exitCode: result.exitCode,
        command: result.command,
        durationMs: result.durationMs,
        timedOut: result.timedOut,
        failureKind: result.failureKind,
      });
    }
    if (record.failed.length > 0) {
      diagnostics.push(...diagnosticsForImpactTestRun(record));
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: "FORGE_VERIFY_CHANGED_INCOMPLETE",
          message: `impact-based verification failed: ${record.failed.join(", ")}; run forge test run --changed --json for details`,
        }),
      );
    }
    const ok = record.failed.length === 0;
    return { ok, profile, steps, diagnostics, durationMs: Date.now() - started, exitCode: ok ? 0 : 1 };
  }

  printProgress(options, "verify: generate-check");
  const generateStarted = Date.now();
  const generateCheck = await runGenerateCommand({
    workspaceRoot: options.workspaceRoot,
    check: true,
    dryRun: false,
    json: false,
    concurrency: 4,
  });
  steps.push({
    name: "generate-check",
    ok: generateCheck.exitCode === 0,
    exitCode: generateCheck.exitCode,
    durationMs: Date.now() - generateStarted,
  });
  steps.push({
    name: "agent-contract-check",
    ok: generateCheck.exitCode === 0,
    exitCode: generateCheck.exitCode,
    durationMs: Date.now() - generateStarted,
  });
  diagnostics.push(...generateCheck.errors, ...generateCheck.warnings);

  printProgress(options, "verify: forge-check");
  const checkStarted = Date.now();
  const forgeCheck = await runCheckCommand(options.workspaceRoot, {
    strictSecrets: options.strict,
  });
  steps.push({
    name: "forge-check",
    ok: forgeCheck.exitCode === 0,
    exitCode: forgeCheck.exitCode,
    durationMs: Date.now() - checkStarted,
  });
  diagnostics.push(...forgeCheck.errors, ...forgeCheck.warnings);

  if (profile === "strict" || profile === "standard") {
    printProgress(options, "verify: policy-check-strict");
    const policyStarted = Date.now();
    const policyCheck = await runPolicyCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      json: false,
      strictPolicies: true,
    });
    steps.push({
      name: "policy-check-strict",
      ok: policyCheck.exitCode === 0,
      exitCode: policyCheck.exitCode,
      durationMs: Date.now() - policyStarted,
    });
    if (policyCheck.diagnostics) {
      diagnostics.push(...policyCheck.diagnostics);
    }
    if (policyCheck.exitCode !== 0) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: FORGE_VERIFY_POLICY,
          message: "forge policy check --strict-policies failed",
        }),
      );
    }

    printProgress(options, "verify: auth-check");
    const authStarted = Date.now();
    const authCheck = await runAuthCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      json: false,
    });
    steps.push({
      name: "auth-check",
      ok: authCheck.exitCode === 0,
      exitCode: authCheck.exitCode,
      durationMs: Date.now() - authStarted,
    });
    if (!authCheck.ok && authCheck.error) {
      diagnostics.push(
        createDiagnostic({
          severity: "error",
          code: authCheck.error.code,
          message: authCheck.error.message,
        }),
      );
    }

    printProgress(options, "verify: rls-check");
    const rlsStarted = Date.now();
    const rlsCheck = await runRlsCommand({
      subcommand: "check",
      workspaceRoot: options.workspaceRoot,
      db: "pglite",
      json: false,
    });
    steps.push({
      name: "rls-check",
      ok: rlsCheck.exitCode === 0,
      exitCode: rlsCheck.exitCode,
      durationMs: Date.now() - rlsStarted,
    });
    diagnostics.push(...rlsCheck.diagnostics);

    const agentTargets = configuredAgentTargets(options.workspaceRoot);
    if (agentTargets.length === 0) {
      steps.push(skippedStep("agent-adapter-check", "no agent adapter exports configured"));
    } else {
      for (const target of agentTargets) {
        const agentCheck = runAgentCheck({
          subcommand: "check",
          workspaceRoot: options.workspaceRoot,
          json: false,
          target,
          dryRun: false,
          force: false,
          preserveUserSections: true,
          skills: true,
          rules: true,
        });
        steps.push({
          name: `agent-adapter-check:${target}`,
          ok: agentCheck.exitCode === 0,
          exitCode: agentCheck.exitCode,
        });
        diagnostics.push(...agentCheck.diagnostics);
      }
    }
  }

  if (options.skipTypecheck) {
    steps.push(skippedStep("typecheck", "--skip-typecheck"));
  } else {
    const typechecker = resolveTypechecker(options);
    printProgress(options, `verify: typecheck (${typechecker}, ${scriptTimeoutMs}ms timeout)`);
    const { result: typecheck, diagnostics: typecheckDiagnostics } = await runPreferredTypecheck(
      options,
      scripts,
      scriptTimeoutMs,
    );
    steps.push({
      name: "typecheck",
      ok: typecheck.exitCode === 0,
      exitCode: typecheck.exitCode,
      command: typecheck.command,
      durationMs: typecheck.durationMs,
      timedOut: typecheck.timedOut,
      failureKind: packageScriptFailureKind(typecheck),
    });
    diagnostics.push(...typecheckDiagnostics);
    if (typecheck.timedOut) {
      diagnostics.push(timedOutDiagnostic("typecheck", scriptTimeoutMs));
    } else if (typecheck.exitCode !== 0) {
      diagnostics.push(
        packageScriptFailureDiagnostic("typecheck", "FORGE_VERIFY_TYPECHECK", typecheck),
      );
    }
  }

  if (profile === "smoke") {
    steps.push(skippedStep("tests", "--smoke/--fast"));
  } else if (options.skipTests) {
    steps.push(skippedStep("tests", "--skip-tests"));
  } else if (profile === "standard") {
    printProgress(options, "verify: impact-tests (standard profile)");
    const impact = await runStandardImpactTests(options);
    steps.push(...impact.steps);
    diagnostics.push(...impact.diagnostics);
    steps.push(skippedStep("tests", "--standard uses impact-selected tests; use --strict for the full test script"));
  } else if (profile === "strict" && !options.fullTests) {
    printProgress(options, `verify: tests (strict TestGraph, ${scriptTimeoutMs}ms timeout)`);
    const tests = await runStrictGraphTests(options.workspaceRoot, scriptTimeoutMs, options.testJobs);
    testGraphPlan = tests.plan;
    steps.push({
      name: "tests:testgraph-strict",
      ok: tests.exitCode === 0,
      exitCode: tests.exitCode,
      command: tests.command,
      durationMs: tests.durationMs,
      timedOut: tests.timedOut,
      failureKind: packageScriptFailureKind(tests),
    });
    if (tests.timedOut) {
      diagnostics.push(timedOutDiagnostic("test", scriptTimeoutMs));
    } else if (tests.exitCode !== 0) {
      diagnostics.push(
        packageScriptFailureDiagnostic("test", "FORGE_VERIFY_TESTS", tests),
      );
    }
  } else if (!scripts.test) {
    steps.push(skippedStep("tests", "no test script in package.json"));
  } else {
    printProgress(options, `verify: tests (${scriptTimeoutMs}ms timeout)`);
    const tests = await runPackageScript(options.workspaceRoot, "test", scriptTimeoutMs);
    steps.push({
      name: "tests",
      ok: tests.exitCode === 0,
      exitCode: tests.exitCode,
      command: tests.command,
      durationMs: tests.durationMs,
      timedOut: tests.timedOut,
      failureKind: packageScriptFailureKind(tests),
    });
    if (tests.timedOut) {
      diagnostics.push(timedOutDiagnostic("test", scriptTimeoutMs));
    } else if (tests.exitCode !== 0) {
      diagnostics.push(
        packageScriptFailureDiagnostic("test", "FORGE_VERIFY_TESTS", tests),
      );
    }
  }

  if (profile === "smoke") {
    steps.push(skippedStep("eslint", "--smoke/--fast"));
  } else if (options.skipEslint) {
    steps.push(skippedStep("eslint", "--skip-eslint"));
  } else {
    const lint = await lintForgeGuards(options.workspaceRoot);
    steps.push({
      name: "eslint",
      ok: lint.exitCode === 0,
      exitCode: lint.exitCode,
    });
    diagnostics.push(...lint.diagnostics);
  }

  const ok = steps.every((step) => step.ok);
  return {
    ok,
    profile,
    steps,
    diagnostics,
    testGraphPlan,
    durationMs: Date.now() - started,
    exitCode: ok ? 0 : 1,
  };
}
