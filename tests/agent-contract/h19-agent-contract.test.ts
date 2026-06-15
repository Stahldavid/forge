import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";
import {
  runGenerateCommand,
  runInspectCommand,
  runVerifyCommand,
} from "../../src/forge/cli/commands.ts";
import { runAgentContractPrint } from "../../src/forge/cli/agent-contract.ts";
import { runDoctorCommand } from "../../src/forge/cli/doctor.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

const GENERATED = "src/forge/_generated";

function readBody(root: string, relative: string): string {
  return stripDeterministicHeader(readFileSync(join(root, relative), "utf8"));
}

function readJson<T>(root: string, relative: string): T {
  return JSON.parse(readBody(root, relative)) as T;
}

describe("H19 agent contract", () => {
  test("generates agent-facing artifacts and contract categories", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-generation");
    try {
      const result = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(result.exitCode).toBe(0);

      expect(existsSync(join(workspace, "AGENTS.md"))).toBe(true);
      for (const artifact of [
        "agentContract.json",
        "agentContract.ts",
        "agentTools.json",
        "agentTools.ts",
        "agentTools.md",
        "appMap.md",
        "capabilityMap.json",
        "capabilityMap.ts",
        "capabilityMap.md",
        "runtimeRules.md",
        "operationPlaybooks.md",
        "agentQuickstart.md",
        "frontendGraph.json",
        "frontendGraph.ts",
      ]) {
        expect(existsSync(join(workspace, GENERATED, artifact))).toBe(true);
      }

      const contract = readJson<{
        commands: Array<{ http?: { method: string; path: string }; frontend?: { hook: string } }>;
        queries: Array<{ http?: { method: string; path: string }; frontend?: { hook: string } }>;
        liveQueries: Array<{ http?: { method: string; path: string }; frontend?: { hook: string } }>;
        actions: unknown[];
        workflows: unknown[];
        data: { tables: unknown[] };
        policies: unknown[];
        secrets: unknown[];
        frontend: { present: boolean; routes: unknown[]; components: unknown[]; runtimeEndpoints: unknown[] };
        capabilityMap?: unknown;
      }>(workspace, `${GENERATED}/agentContract.json`);

      expect(contract.commands.length).toBeGreaterThan(0);
      expect(contract.queries.length).toBeGreaterThan(0);
      expect(contract.liveQueries.length).toBeGreaterThan(0);
      expect(contract.actions).toBeArray();
      expect(contract.workflows).toBeArray();
      expect(contract.data.tables.length).toBeGreaterThan(0);
      expect(contract.policies).toBeArray();
      expect(contract.secrets).toBeArray();
      expect(contract.frontend.present).toBeBoolean();
      expect(contract.frontend.routes).toBeArray();
      expect(contract.frontend.runtimeEndpoints.length).toBeGreaterThan(0);
      expect(contract.commands[0]?.http?.method).toBe("POST");
      expect(contract.commands[0]?.http?.path.startsWith("/commands/")).toBe(true);
      expect(contract.commands[0]?.frontend?.hook).toContain("useCommand");
      expect(contract.queries[0]?.http?.path.startsWith("/queries/")).toBe(true);
      expect(contract.liveQueries[0]?.http?.method).toBe("GET");

      const tools = readJson<{
        autoTools: Array<{
          sourceKind: "command" | "query" | "liveQuery";
          sourceName: string;
          http: { path: string };
          requiresAuth: boolean;
        }>;
      }>(workspace, `${GENERATED}/agentTools.json`);
      expect(tools.autoTools.some((tool) => tool.sourceKind === "command" && tool.http.path.startsWith("/commands/"))).toBe(true);
      expect(tools.autoTools.some((tool) => tool.sourceKind === "query" && tool.http.path.startsWith("/queries/"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("AGENTS.md preserves user notes section", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-user-notes");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const agentsPath = join(workspace, "AGENTS.md");
      writeFileSync(
        agentsPath,
        readFileSync(agentsPath, "utf8").replace(
          "Project-specific notes can go here.",
          "Keep billing changes behind owner review.",
        ),
        "utf8",
      );

      const regenerated = await runGenerateCommand(defaultGenerateOptions(workspace));
      expect(regenerated.exitCode).toBe(0);
      expect(readFileSync(agentsPath, "utf8")).toContain(
        "Keep billing changes behind owner review.",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("markdown maps include rules and playbooks", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-markdown");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));

      expect(readBody(workspace, `${GENERATED}/runtimeRules.md`)).toContain("## command");
      expect(readBody(workspace, `${GENERATED}/runtimeRules.md`)).toContain("## query");
      expect(readBody(workspace, `${GENERATED}/runtimeRules.md`)).toContain("## action");
      expect(readBody(workspace, `${GENERATED}/runtimeRules.md`)).toContain("## workflow");
      expect(readBody(workspace, `${GENERATED}/appMap.md`)).toContain("# App Map");
      expect(readBody(workspace, `${GENERATED}/operationPlaybooks.md`)).toContain(
        "## Add a command",
      );
      expect(readBody(workspace, `${GENERATED}/agentTools.md`)).toContain("# Agent Tools");
      expect(readBody(workspace, `${GENERATED}/agentTools.md`)).toContain(
        "## Auto Tools From Forge Runtime",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("inspect all and agent-contract print expose generated contract", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-inspect");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));

      const inspect = await runInspectCommand("all", workspace);
      expect(inspect.exitCode).toBe(0);
      expect((inspect.data as { agentContract?: unknown }).agentContract).toBeTruthy();
      expect((inspect.data as { frontend?: unknown }).frontend).toBeTruthy();

      const frontend = await runInspectCommand("frontend", workspace);
      expect(frontend.exitCode).toBe(0);
      expect((frontend.data as { schemaVersion?: string }).schemaVersion).toBe("0.1.0");

      const rules = await runInspectCommand("rules", workspace);
      expect(rules.exitCode).toBe(0);
      expect(rules.data).toContain("# Runtime Rules");

      const printed = runAgentContractPrint(workspace);
      expect(printed.exitCode).toBe(0);
      expect((printed.data as { schemaVersion?: string }).schemaVersion).toBe("0.1.0");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("doctor reports healthy and missing generated artifacts", async () => {
    const missing = scaffoldGenerateWorkspace("h19-doctor-missing");
    try {
      const missingResult = await runDoctorCommand({ workspaceRoot: missing });
      expect(missingResult.exitCode).toBe(1);
      expect(missingResult.checks.some((check) => check.name === "agent-contract" && !check.ok)).toBe(true);
    } finally {
      cleanupWorkspace(missing);
    }

    const healthy = scaffoldGenerateWorkspace("h19-doctor-healthy");
    try {
      await runGenerateCommand(defaultGenerateOptions(healthy));
      const result = await runDoctorCommand({ workspaceRoot: healthy });
      expect(result.exitCode).toBe(0);
      expect(result.ok).toBe(true);
    } finally {
      cleanupWorkspace(healthy);
    }
  }, 30_000);

  test("agent-contract check detects stale contract", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-stale");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      writeFileSync(
        join(workspace, GENERATED, "agentContract.json"),
        `${readFileSync(join(workspace, GENERATED, "agentContract.json"), "utf8")}\n// stale\n`,
        "utf8",
      );

      const checked = await runGenerateCommand({
        ...defaultGenerateOptions(workspace),
        check: true,
      });
      expect(checked.exitCode).toBe(1);
      expect(checked.warnings.some((warning) => warning.file?.endsWith("agentContract.json"))).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("contract does not include env secret values", async () => {
    const workspace = scaffoldGenerateWorkspace("h19-secret-redaction");
    try {
      writeFileSync(join(workspace, ".env.local"), "STRIPE_SECRET_KEY=sk_live_never_emit_this\n", "utf8");
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const serialized = [
        readBody(workspace, `${GENERATED}/agentContract.json`),
        readBody(workspace, "AGENTS.md"),
      ].join("\n");
      expect(serialized).not.toContain("sk_live_never_emit_this");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);

  test("parseCli and verify strict include H19 commands", async () => {
    expect(parseCli(["agent-contract", "generate"]).command).toMatchObject({
      kind: "agent-contract",
      subcommand: "generate",
    });
    expect(parseCli(["doctor", "--json"]).command).toMatchObject({
      kind: "doctor",
      json: true,
    });
    expect(parseCli(["inspect", "all", "--json"]).errors).toEqual([]);
    expect(parseCli(["inspect", "frontend", "--json"]).errors).toEqual([]);
    expect(parseCli(["inspect", "capability-map", "--json"]).errors).toEqual([]);

    const workspace = scaffoldGenerateWorkspace("h19-verify");
    try {
      await runGenerateCommand(defaultGenerateOptions(workspace));
      const result = await runVerifyCommand({
        workspaceRoot: workspace,
        json: false,
        skipTests: true,
        skipTypecheck: true,
        skipEslint: true,
        strict: true,
      });
      expect(result.steps.some((step) => step.name === "agent-contract-check")).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 30_000);
});
