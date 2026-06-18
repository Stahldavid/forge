import { describe, expect, test } from "bun:test";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { main } from "../../src/forge/cli/main.ts";
import { resolveBunExecutable } from "../../src/forge/cli/bun-exec.ts";
import {
  buildStrictTestGraphPlan,
  chunkFiles,
  classifyStrictTestFile,
  packWeightedStrictTestChunks,
  resolveStrictIsolatedTestJobs,
  resolveStrictTestJobs,
} from "../../src/forge/cli/verify.ts";

describe("Forge CLI", () => {
  test("parseCli rejects unsupported inspect target", () => {
    const parsed = parseCli(["inspect", "unknown"]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.command).toBeNull();
  });

  test("parseCli accepts supported inspect targets", () => {
    for (const target of [
      "app",
      "packages",
      "capabilities",
      "runtime-matrix",
      "data",
      "runtime",
      "dev",
      "agent-contract",
      "framework",
    ]) {
      const parsed = parseCli(["inspect", target]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("inspect");
    }
  });

  test("hasUnknownOption flags unrecognized options", () => {
    expect(hasUnknownOption(["generate", "--nope"])).toBe("--nope");
    expect(hasUnknownOption(["generate", "--check"])).toBeNull();
  });

  test("main returns exit 1 for unrecognized command", async () => {
    const code = await main(["not-a-command"]);
    expect(code).toBe(1);
  });

  test("main prints focused help for empty command", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(output).toContain("forge dev --once --json");
      expect(output).toContain("forge do \"fix\" --json");
      expect(output).toContain("forge doctor windows --json");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints JSON CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output) as { version?: string; cliVersion?: string };
      expect(parsed.version).toBe(parsed.cliVersion);
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("parseCli accepts verify with skip flags", () => {
    const parsed = parseCli([
      "verify",
      "--json",
      "--skip-tests",
      "--skip-eslint",
      "--smoke",
      "--script-timeout-ms",
      "1234",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("verify");
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.skipTests).toBe(true);
      expect(parsed.command.options.skipEslint).toBe(true);
      expect(parsed.command.options.smoke).toBe(true);
      expect(parsed.command.options.scriptTimeoutMs).toBe(1234);
    }
  });

  test("parseCli accepts verify typechecker, test jobs, test plan, and compiler bench", () => {
    const verify = parseCli(["verify", "--typechecker", "auto", "--test-jobs", "3", "--test-plan", "--json"]);
    expect(verify.errors).toEqual([]);
    expect(verify.command?.kind).toBe("verify");
    if (verify.command?.kind === "verify") {
      expect(verify.command.options.typechecker).toBe("auto");
      expect(verify.command.options.testJobs).toBe(3);
      expect(verify.command.options.testPlan).toBe(true);
    }

    const bench = parseCli(["bench", "compiler", "--json", "--iterations", "2", "--warmups", "0", "--concurrency", "3"]);
    expect(bench.errors).toEqual([]);
    expect(bench.command?.kind).toBe("bench");
    if (bench.command?.kind === "bench") {
      expect(bench.command.options.iterations).toBe(2);
      expect(bench.command.options.warmups).toBe(0);
      expect(bench.command.options.concurrency).toBe(3);
    }
  });

  test("strict TestGraph jobs are bounded and configurable", () => {
    expect(chunkFiles(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(resolveStrictTestJobs({ requested: 99, chunkCount: 3 })).toBe(3);
    expect(resolveStrictTestJobs({ requested: 1, chunkCount: 3 })).toBe(1);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "not-a-number" }, chunkCount: 1 })).toBe(1);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 5 })).toBe(4);
    expect(resolveStrictIsolatedTestJobs({ env: { FORGE_VERIFY_ISOLATED_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 3 })).toBe(3);
  });

  test("strict TestGraph weighted chunks balance slow files", () => {
    const chunks = packWeightedStrictTestChunks(
      [
        { file: "slow-a.test.ts", estimatedMs: 10_000, durationSource: "profile" },
        { file: "slow-b.test.ts", estimatedMs: 9_000, durationSource: "profile" },
        { file: "fast-a.test.ts", estimatedMs: 500, durationSource: "fallback" },
        { file: "fast-b.test.ts", estimatedMs: 500, durationSource: "fallback" },
      ],
      2,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks[1]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks.some((chunk) => chunk.files.includes("slow-a.test.ts") && chunk.files.includes("slow-b.test.ts"))).toBe(false);
  });

  test("strict TestGraph plan is available without running tests", () => {
    const plan = buildStrictTestGraphPlan(process.cwd(), 3, {});
    expect(plan.fileCount).toBeGreaterThan(0);
    expect(plan.chunkCount).toBeGreaterThan(0);
    expect(plan.totalJobs).toBeLessThanOrEqual(3);
    expect(plan.laneMode).toBe("overlap");
    expect(plan.jobs + plan.isolatedJobs).toBeLessThanOrEqual(plan.totalJobs);
    expect(plan.jobs).toBeGreaterThan(0);
    expect(plan.isolatedJobs).toBeGreaterThan(0);
    expect(plan.lanes.serial.chunkCount).toBe(0);
    expect(plan.slowestFiles.length).toBeGreaterThan(0);

    const singleWorkerPlan = buildStrictTestGraphPlan(process.cwd(), 1, {});
    expect(singleWorkerPlan.totalJobs).toBe(1);
    expect(singleWorkerPlan.laneMode).toBe("sequential");
    expect(singleWorkerPlan.jobs).toBe(1);
    expect(singleWorkerPlan.isolatedJobs).toBe(1);
  });

  test("strict TestGraph lanes isolate global-heavy tests without serializing them", () => {
    expect(classifyStrictTestFile("tests/client/client-query.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/db/pglite-adapter.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/dev/server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-bridge.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-cli.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-node-cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/go-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/java-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-generation.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/cli/node-compat-dev-server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat-new.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify-changed.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner-diagnostics.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-artifacts.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-self-host.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-apply.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-bindings.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/security/tenant-isolation/http-runtime.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/templates/create-forge-app.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/classifier/classify.test.ts")).toBe("parallel");
  });

  test("parseCli accepts impact test timeout", () => {
    const parsed = parseCli(["test", "run", "--changed", "--timeout-ms", "77", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("test");
    if (parsed.command?.kind === "test") {
      expect(parsed.command.options.timeoutMs).toBe(77);
    }
  });

  test("resolveBunExecutable ignores extensionless Windows PATH entries", () => {
    const kiroShim = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable ignores Kiro-Cli Windows bun executables", () => {
    const kiroExe = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun || path === kiroExe,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroExe,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable normalizes Windows bun shims with an exe sibling", () => {
    const bunShim = "C:\\Users\\David\\.bun\\bin\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => bunShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable refuses ambiguous Windows bun fallback", () => {
    expect(() => resolveBunExecutable({
      env: {},
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: () => false,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe",
    })).toThrow("Unable to resolve a safe Bun executable on Windows");
  });

  test("resolveBunExecutable honors explicit FORGE_BUN", () => {
    const realBun = "D:\\Tools\\bun\\bun.exe";
    const resolved = resolveBunExecutable({
      env: { FORGE_BUN: realBun },
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => null,
    });

    expect(resolved).toBe(realBun);
  });

  test("parseCli accepts dev with port and watch flags", () => {
    const parsed = parseCli(["dev", "--port", "4000", "--watch", "--mock", "--db", "memory", "--skip-startup-console"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind === "dev") {
      expect(parsed.command.port).toBe(4000);
      expect(parsed.command.watch).toBe(true);
      expect(parsed.command.mock).toBe(true);
      expect(parsed.command.db).toBe("memory");
      expect(parsed.command.skipStartupConsole).toBe(true);
    }
  });

});
