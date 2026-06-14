import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { buildTestGraph } from "../../src/forge/compiler/test-graph/build.ts";
import type { AppGraph } from "../../src/forge/compiler/types/app-graph.ts";
import type { PackageGraph } from "../../src/forge/compiler/types/package-graph.ts";
import type { TestGraph } from "../../src/forge/compiler/types/test-graph.ts";
import { analyzeImpact, buildImpactTestPlan, formatImpactHuman, formatImpactJson, runImpactTestPlan, runTestCommand } from "../../src/forge/impact/index.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h28-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

const appGraph: AppGraph = {
  schemaVersion: "0.1.0",
  generatorVersion: "0.0.0",
  analyzerVersion: "test",
  inputHash: "hash",
  symbols: [
    { id: "table:tickets", kind: "schema.table", name: "tickets", qualifiedName: "tickets", file: "src/forge/schema.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: {} },
    { id: "command:createTicket", kind: "command", name: "createTicket", qualifiedName: "createTicket", file: "src/commands/createTicket.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: { table: "tickets" } },
    { id: "query:listTickets", kind: "query", name: "listTickets", qualifiedName: "listTickets", file: "src/queries/listTickets.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: { table: "tickets" } },
    { id: "live:liveTickets", kind: "liveQuery", name: "liveTickets", qualifiedName: "liveTickets", file: "src/queries/liveTickets.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: { table: "tickets" } },
    { id: "action:captureTicketCreated", kind: "action", name: "captureTicketCreated", qualifiedName: "captureTicketCreated", file: "src/actions/captureTicketCreated.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: {} },
    { id: "workflow:triageTicketWorkflow", kind: "workflow", name: "triageTicketWorkflow", qualifiedName: "triageTicketWorkflow", file: "src/workflows/triageTicketWorkflow.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: {} },
    { id: "policy:tickets.create", kind: "policy", name: "tickets.create", qualifiedName: "tickets.create", file: "src/policies.ts", span: { start: 0, end: 1 }, contentHash: "x", meta: {} },
  ],
  edges: [],
  moduleGraph: { nodes: [] },
  diagnostics: [],
};

const packageGraph: PackageGraph = {
  schemaVersion: "0.1.0",
  generatorVersion: "0.0.0",
  analyzerVersion: "test",
  packages: [],
};

function writeGenerated(root: string, testGraph: TestGraph): void {
  write(root, "src/forge/_generated/appGraph.json", JSON.stringify(appGraph));
  write(root, "src/forge/_generated/dataGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    tables: [{ id: "tickets", name: "tickets", symbolId: "table:tickets", exportName: "tickets", file: "src/forge/schema.ts", fields: [{ name: "title", type: "text" }] }],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/packageGraph.json", JSON.stringify(packageGraph));
  write(root, "src/forge/_generated/runtimeGraph.json", JSON.stringify({
    schemaVersion: "0.1.0",
    generatorVersion: "0.0.0",
    analyzerVersion: "test",
    inputHash: "hash",
    entries: [{ id: "command:createTicket", kind: "command", name: "createTicket", qualifiedName: "createTicket", file: "src/commands/createTicket.ts", moduleId: "src/commands/createTicket.ts", runtimeContext: "command", dependencies: [] }],
    diagnostics: [],
  }));
  write(root, "src/forge/_generated/queryRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", queries: [{ name: "listTickets", qualifiedName: "listTickets", file: "src/queries/listTickets.ts", symbolId: "query:listTickets", moduleId: "src/queries/listTickets.ts" }], diagnostics: [] }));
  write(root, "src/forge/_generated/liveQueryRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", liveQueries: [{ name: "liveTickets", qualifiedName: "liveTickets", file: "src/queries/liveTickets.ts", exportName: "liveTickets", symbolId: "live:liveTickets", moduleId: "src/queries/liveTickets.ts", policy: "tickets.read" }], diagnostics: [] }));
  write(root, "src/forge/_generated/policyRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", policies: [{ name: "tickets.create", kind: "roles", roles: ["admin"], file: "src/policies.ts", symbolId: "policy:tickets.create" }], commandAuth: [], queryAuth: [], diagnostics: [] }));
  write(root, "src/forge/_generated/actionSubscriptions.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", subscriptions: [{ eventType: "ticket.created", actionName: "captureTicketCreated", exportName: "captureTicketCreated", file: "src/actions/captureTicketCreated.ts", symbolId: "action:captureTicketCreated" }], byEvent: { "ticket.created": [{ eventType: "ticket.created", actionName: "captureTicketCreated", exportName: "captureTicketCreated", file: "src/actions/captureTicketCreated.ts", symbolId: "action:captureTicketCreated" }] }, diagnostics: [] }));
  write(root, "src/forge/_generated/workflowRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", workflows: [], diagnostics: [] }));
  write(root, "src/forge/_generated/workflowSubscriptions.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", subscriptions: [{ eventType: "ticket.created", workflowName: "triageTicketWorkflow", exportName: "triageTicketWorkflow", file: "src/workflows/triageTicketWorkflow.ts", symbolId: "workflow:triageTicketWorkflow" }], byEvent: { "ticket.created": [{ eventType: "ticket.created", workflowName: "triageTicketWorkflow", exportName: "triageTicketWorkflow", file: "src/workflows/triageTicketWorkflow.ts", symbolId: "workflow:triageTicketWorkflow" }] }, diagnostics: [] }));
  write(root, "src/forge/_generated/testGraph.json", JSON.stringify(testGraph));
}

describe("H28 impact-based test planner", () => {
  test("TestGraph maps tests to symbols using path, api references, and literals", () => {
    const root = workspace();
    write(root, "tests/commands/createTicket.test.ts", `
      import { api } from "../../src/forge/_generated/api";
      test("createTicket tickets.create", () => api.commands.createTicket);
    `);

    const graph = buildTestGraph({
      workspaceRoot: root,
      inputHash: "hash",
      appGraph,
      packageGraph,
      sources: [],
    });

    expect(graph.tests).toHaveLength(1);
    expect(graph.tests[0].confidence).toBe("confirmed");
    expect(graph.tests[0].covers.commands).toContain("createTicket");
    expect(graph.tests[0].covers.policies).toContain("tickets.create");
  });

  test("staged command change impacts command, table, action, workflow, and targeted tests", () => {
    const root = workspace();
    spawnSync("git", ["init"], { cwd: root, windowsHide: true });
    write(root, "src/commands/createTicket.ts", `export async function createTicket(ctx) { await ctx.db.insert("tickets", {}); ctx.emit("ticket.created", {}); }`);
    write(root, "tests/commands/createTicket.test.ts", `test("createTicket", () => "tickets");`);
    spawnSync("git", ["add", "src/commands/createTicket.ts"], { cwd: root, windowsHide: true });

    const graph = buildTestGraph({ workspaceRoot: root, inputHash: "hash", appGraph, packageGraph, sources: [] });
    writeGenerated(root, graph);

    const report = analyzeImpact({
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: true,
      includeGenerated: false,
      excludeTests: false,
    });
    expect(report.changedFiles).toEqual(["src/commands/createTicket.ts"]);
    expect(report.impacted.runtime.commands).toContain("createTicket");
    expect(report.impacted.data.tables).toContain("tickets");
    expect(report.impacted.runtime.actions).toContain("captureTicketCreated");
    expect(report.impacted.runtime.workflows).toContain("triageTicketWorkflow");
    write(root, ".forge/test-runs/last.json", JSON.stringify({
      schemaVersion: "0.1.0",
      id: "run_test",
      changedHash: "sha256:test",
      planHash: "sha256:test",
      source: { mode: "changed", base: "HEAD" },
      commands: ["bun test tests/commands/createTicket.test.ts"],
      results: [{
        command: "bun test tests/commands/createTicket.test.ts",
        ok: false,
        exitCode: 1,
        durationMs: 42,
        failureKind: "test-failure",
      }],
      failed: ["bun test tests/commands/createTicket.test.ts"],
      durationMs: 42,
    }));

    const plan = buildImpactTestPlan({
      subcommand: "plan",
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: true,
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
    });
    expect(plan.tests.map((test) => test.file)).toContain("tests/commands/createTicket.test.ts");
    expect(plan.tests.find((test) => test.file === "tests/commands/createTicket.test.ts")?.lastDurationMs).toBe(42);
    expect(plan.tests.find((test) => test.file === "tests/commands/createTicket.test.ts")?.lastRunOk).toBe(false);
    expect(plan.requiredChecks.map((check) => check.command)).toContain("forge check");
  });

  test("changed files are scoped to nested Forge workspace inside a parent git repo", () => {
    const parent = workspace();
    const app = join(parent, "apps", "notes");
    spawnSync("git", ["init"], { cwd: parent, windowsHide: true });
    write(parent, "README.md", "parent change");
    write(app, "src/commands/createTicket.ts", `export async function createTicket(ctx) { await ctx.db.insert("tickets", {}); }`);
    spawnSync("git", ["add", "README.md", "apps/notes/src/commands/createTicket.ts"], {
      cwd: parent,
      windowsHide: true,
    });

    const graph = buildTestGraph({ workspaceRoot: app, inputHash: "hash", appGraph, packageGraph, sources: [] });
    writeGenerated(app, graph);

    const report = analyzeImpact({
      workspaceRoot: app,
      json: true,
      write: false,
      changed: false,
      staged: true,
      includeGenerated: false,
      excludeTests: false,
    });

    expect(report.changedFiles).toEqual(["src/commands/createTicket.ts"]);
    expect(report.impacted.runtime.commands).toContain("createTicket");
  });

  test("forge.lock is treated as a generated Forge artifact, not a dependency lockfile", () => {
    const root = workspace();
    spawnSync("git", ["init"], { cwd: root, windowsHide: true });
    write(root, "forge.lock", "generated lock changed");
    spawnSync("git", ["add", "forge.lock"], { cwd: root, windowsHide: true });
    const graph = buildTestGraph({ workspaceRoot: root, inputHash: "hash", appGraph, packageGraph, sources: [] });
    writeGenerated(root, graph);

    const report = analyzeImpact({
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: true,
      includeGenerated: false,
      excludeTests: false,
    });

    expect(report.impacted.generatedArtifacts).toContain("forge.lock");
    expect(report.impacted.packages).toEqual([]);
  });

  test("changed weak-confidence test files are still selected", () => {
    const root = workspace();
    spawnSync("git", ["init"], { cwd: root, windowsHide: true });
    write(root, "tests/impact/h28-impact.test.ts", `test("changed weak test", () => {});`);
    spawnSync("git", ["add", "tests/impact/h28-impact.test.ts"], { cwd: root, windowsHide: true });
    writeGenerated(root, {
      schemaVersion: "0.1.0",
      generatorVersion: "0.0.0",
      analyzerVersion: "test",
      inputHash: "hash",
      diagnostics: [],
      tests: [{
        file: "tests/impact/h28-impact.test.ts",
        kind: "unknown",
        cost: "fast",
        confidence: "weak",
        covers: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [], tables: [], policies: [], packages: [], components: [] },
        reasons: [],
      }],
    });

    const plan = buildImpactTestPlan({
      subcommand: "plan",
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: true,
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
    });

    expect(plan.tests.map((test) => test.file)).toContain("tests/impact/h28-impact.test.ts");
  });

  test("cost filtering excludes browser tests unless explicitly included", () => {
    const root = workspace();
    spawnSync("git", ["init"], { cwd: root, windowsHide: true });
    write(root, "web/components/TicketList.tsx", `export function TicketList() { return null; }`);
    write(root, "tests/react/TicketList.test.tsx", `import "playwright"; test("TicketList", () => {});`);
    spawnSync("git", ["add", "web/components/TicketList.tsx"], { cwd: root, windowsHide: true });
    const graph = buildTestGraph({ workspaceRoot: root, inputHash: "hash", appGraph, packageGraph, sources: [] });
    writeGenerated(root, graph);

    const fast = buildImpactTestPlan({ subcommand: "plan", workspaceRoot: root, json: true, write: false, changed: false, staged: true, maxCost: "standard", includeDocker: false, includeBrowser: false, bail: false });
    expect(fast.tests).toHaveLength(0);

    const browser = buildImpactTestPlan({ subcommand: "plan", workspaceRoot: root, json: true, write: false, changed: false, staged: true, maxCost: "browser", includeDocker: false, includeBrowser: true, bail: false });
    expect(browser.tests.map((test) => test.file)).toContain("tests/react/TicketList.test.tsx");
  });

  test("test graph does not classify ordinary includeBrowser/includeDocker text as expensive cost", () => {
    const root = workspace();
    write(root, "tests/impact/options.test.ts", `
      test("planner options", () => {
        const includeBrowser = false;
        const includeDocker = false;
        expect(includeBrowser || includeDocker).toBe(false);
      });
    `);

    const graph = buildTestGraph({ workspaceRoot: root, inputHash: "hash", appGraph, packageGraph, sources: [] });
    expect(graph.tests.find((entry) => entry.file === "tests/impact/options.test.ts")?.cost).toBe("fast");
  });

  test("targeted runner records successful test run", async () => {
    const root = workspace();
    write(root, "tests/pass.test.ts", `import { test, expect } from "bun:test"; test("pass", () => expect(1).toBe(1));`);
    const record = await runImpactTestPlan(root, {
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["tests/pass.test.ts"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [],
      tests: [{ file: "tests/pass.test.ts", command: "bun test tests/pass.test.ts", reason: "changed test file", cost: "fast", confidence: "confirmed" }],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }, { bail: false });
    expect(record.failed).toEqual([]);
    expect(record.results[0].ok).toBe(true);
  });

  test("targeted runner times out hanging commands", async () => {
    const root = workspace();
    write(root, "scripts/hang.mjs", `setTimeout(() => {}, 5000);`);
    const record = await runImpactTestPlan(root, {
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["scripts/hang.mjs"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [{ kind: "script", command: "node scripts/hang.mjs", cost: "fast", reason: "timeout test" }],
      tests: [],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }, { bail: false, timeoutMs: 50 });

    expect(record.failed).toEqual(["node scripts/hang.mjs"]);
    expect(record.timeoutMs).toBe(50);
    expect(record.results[0].timedOut).toBe(true);
    expect(record.results[0].failureKind).toBe("timeout");
    expect(formatImpactHuman({ ok: false, diagnostics: [], exitCode: 1, run: record })).toContain("timed out after 50ms");
  });

  test("targeted runner records command resolution failures", async () => {
    const root = workspace();
    const previous = process.env.FORGE_BUN;
    process.env.FORGE_BUN = join(root, "missing-bun.exe");
    try {
      const record = await runImpactTestPlan(root, {
        schemaVersion: "0.1.0",
        source: { mode: "changed", base: "HEAD" },
        changedFiles: ["tests/pass.test.ts"],
        impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
        risk: { level: "low", reasons: [] },
        requiredChecks: [],
        tests: [{ file: "tests/pass.test.ts", command: "bun test tests/pass.test.ts", reason: "changed test file", cost: "fast", confidence: "confirmed" }],
        optionalChecks: [],
        finalVerification: ["forge verify --strict"],
      }, { bail: false, timeoutMs: 50 });

      expect(record.failed).toEqual(["bun test tests/pass.test.ts --timeout 50"]);
      expect(record.results[0].failureKind).toBe("command-resolution-error");
      expect(record.results[0].stderr).toContain("FORGE_BUN does not point to a safe Bun executable");
      expect(formatImpactHuman({ ok: false, diagnostics: [], exitCode: 1, run: record })).toContain("command resolution failed");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
    }
  });

  test("forge test run surfaces timeout diagnostics", async () => {
    const root = workspace();
    write(root, "scripts/hang.mjs", `setTimeout(() => {}, 5000);`);
    write(root, ".forge/test-plans/timeout/plan.json", JSON.stringify({
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["scripts/hang.mjs"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [{ kind: "script", command: "node scripts/hang.mjs", cost: "fast", reason: "timeout test" }],
      tests: [],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }));

    const result = await runTestCommand({
      subcommand: "run",
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: false,
      planPath: ".forge/test-plans/timeout/plan.json",
      maxCost: "standard",
      includeDocker: false,
      includeBrowser: false,
      bail: false,
      timeoutMs: 50,
    });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]?.code).toBe("FORGE_TEST_RUN_TIMEOUT");
  });

  test("forge test run surfaces command resolution diagnostics", async () => {
    const root = workspace();
    const previous = process.env.FORGE_BUN;
    process.env.FORGE_BUN = join(root, "missing-bun.exe");
    write(root, ".forge/test-plans/command-resolution/plan.json", JSON.stringify({
      schemaVersion: "0.1.0",
      source: { mode: "changed", base: "HEAD" },
      changedFiles: ["tests/pass.test.ts"],
      impacted: { data: { tables: [], fields: [] }, runtime: { commands: [], queries: [], liveQueries: [], actions: [], workflows: [] }, frontend: { components: [], pages: [] }, policies: [], packages: [], generatedArtifacts: [], deploy: [] },
      risk: { level: "low", reasons: [] },
      requiredChecks: [],
      tests: [{ file: "tests/pass.test.ts", command: "bun test tests/pass.test.ts", reason: "changed test file", cost: "fast", confidence: "confirmed" }],
      optionalChecks: [],
      finalVerification: ["forge verify --strict"],
    }));

    try {
      const result = await runTestCommand({
        subcommand: "run",
        workspaceRoot: root,
        json: true,
        write: false,
        changed: false,
        staged: false,
        planPath: ".forge/test-plans/command-resolution/plan.json",
        maxCost: "standard",
        includeDocker: false,
        includeBrowser: false,
        bail: false,
        timeoutMs: 50,
      });

      expect(result.exitCode).toBe(1);
      expect(result.diagnostics[0]?.code).toBe("FORGE_TEST_COMMAND_RESOLUTION_FAILED");
      expect(result.diagnostics[0]?.fixHint).toContain("FORGE_BUN");
      const json = JSON.parse(formatImpactJson(result));
      expect(json.ok).toBe(false);
      expect(json.run.failed).toEqual(["bun test tests/pass.test.ts --timeout 50"]);
      expect(json.diagnostics[0]?.code).toBe("FORGE_TEST_COMMAND_RESOLUTION_FAILED");
    } finally {
      if (previous === undefined) {
        delete process.env.FORGE_BUN;
      } else {
        process.env.FORGE_BUN = previous;
      }
    }
  });
});
