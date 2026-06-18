import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { runCompilerBenchCommand } from "../../src/forge/bench.ts";
import {
  runCheckCommand,
  runGenerateCommand,
  runInspectCommand,
} from "../../src/forge/cli/commands.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

describe("Forge CLI generation and inspection", () => {
  test("generate --json emits one JSON document on stdout", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-generate-json");
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";

    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const parsed = parseCli(["generate", "--json"]);
      expect(parsed.command?.kind).toBe("generate");

      const result = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });

      expect(() => JSON.parse(output || "{}")).not.toThrow();
      expect(result.exitCode).toBe(0);
    } finally {
      process.stdout.write = originalWrite;
      cleanupWorkspace(workspace);
    }
  });

  test("generate --dry-run does not write files", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-dry-run");
    try {
      const result = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        dryRun: true,
      });
      expect(result.changed.length).toBeGreaterThan(0);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("check exits 0 when guard artifacts are present", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-check-guards");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runCheckCommand(workspace);
      expect(result.exitCode).toBe(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("compiler bench reports public phase timings", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-bench-compiler");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runCompilerBenchCommand({
        subcommand: "compiler",
        workspaceRoot: workspace,
        json: true,
        iterations: 1,
        warmups: 0,
        concurrency: 2,
      });
      expect(result.exitCode).toBe(0);
      expect(result.results).toHaveLength(1);
      expect(result.summary.medianMs).toBeGreaterThanOrEqual(0);
      expect(result.results[0]?.phases.packageGraphMs).toBeGreaterThanOrEqual(0);
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect returns error when artifacts are missing", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-missing");
    try {
      const result = await runInspectCommand("app", workspace);
      expect(result.exitCode).toBe(1);
      expect(result.errors[0]?.code).toBe("FORGE_INSPECT_MISSING");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("inspect framework returns framework-level context", async () => {
    const result = await runInspectCommand("framework", process.cwd());
    expect(result.exitCode).toBe(0);
    expect(result.data).toMatchObject({
      schemaVersion: "0.1.0",
      project: {
        type: "forgeos-framework",
      },
    });
    expect(JSON.stringify(result.data)).toContain("forge dev --once --json");
    expect(JSON.stringify(result.data)).toContain("minimal-web");
  });

  test("inspect agent-contract reads the generated agent contract", async () => {
    const workspace = scaffoldGenerateWorkspace("cli-inspect-agent-contract");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runInspectCommand("agent-contract", workspace);
      expect(result.exitCode).toBe(0);
      expect(result.data).toMatchObject({
        schemaVersion: "0.1.0",
      });
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
