import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { parseCli } from "../../src/forge/cli/parse.ts";
import type { ApiSurface } from "../../src/forge/compiler/api-surface/build.ts";
import type { AppGraph } from "../../src/forge/compiler/types/app-graph.ts";
import type { PackageGraph } from "../../src/forge/compiler/types/package-graph.ts";
import { buildImpactTestPlan } from "../../src/forge/impact/index.ts";
import { diagnoseRepair } from "../../src/forge/repair/index.ts";
import { runReviewCommand } from "../../src/forge/review/index.ts";
import {
  buildUiGeneratedArtifacts,
  runUiCommand,
  serializeUiScenariosJson,
  validateUiScenario,
} from "../../src/forge/ui/index.ts";
import type { UiCommandOptions, UiRunReport } from "../../src/forge/ui/types.ts";

function workspace(): string {
  const root = join(tmpdir(), `forge-h32-${crypto.randomUUID()}`);
  mkdirSync(root, { recursive: true });
  spawnSync("git", ["init"], { cwd: root, windowsHide: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function stage(root: string, ...files: string[]): void {
  spawnSync("git", ["add", ...files], { cwd: root, windowsHide: true });
}

const appGraph: AppGraph = {
  schemaVersion: "0.1.0",
  generatorVersion: "0.0.0",
  analyzerVersion: "test",
  inputHash: "hash",
  symbols: [
    { id: "policy:tickets.read", kind: "policy", name: "tickets.read", qualifiedName: "tickets.read", file: "src/policies.ts", span: { start: 1, end: 1 }, contentHash: "x", meta: {} },
    { id: "policy:tickets.create", kind: "policy", name: "tickets.create", qualifiedName: "tickets.create", file: "src/policies.ts", span: { start: 1, end: 1 }, contentHash: "x", meta: {} },
    { id: "policy:billing.manage", kind: "policy", name: "billing.manage", qualifiedName: "billing.manage", file: "src/policies.ts", span: { start: 1, end: 1 }, contentHash: "x", meta: {} },
  ],
  edges: [],
  moduleGraph: { nodes: [] },
  diagnostics: [],
};

const apiSurface: ApiSurface = {
  schemaVersion: "1.0.0",
  generatorVersion: "0.0.0",
  inputHash: "hash",
  queries: { listTickets: "listTickets" },
  commands: { createTicket: "createTicket", manageBilling: "manageBilling" },
  liveQueries: { liveTickets: "liveTickets" },
  actions: {},
  workflows: { triageTicketWorkflow: "triageTicketWorkflow" },
};

const packageGraph: PackageGraph = {
  schemaVersion: "0.1.0",
  generatorVersion: "0.0.0",
  analyzerVersion: "test",
  packages: [],
};

function writeGenerated(root: string): void {
  const ui = buildUiGeneratedArtifacts({
    appGraph,
    apiSurface,
    sources: [
      { path: "web/app/page.tsx", text: "export default function Page() {}", contentHash: "x" },
      { path: "web/app/tickets/page.tsx", text: "export default function Tickets() {}", contentHash: "x" },
    ],
  });
  write(root, "src/forge/_generated/uiTestManifest.json", JSON.stringify(ui.manifest));
  write(root, "src/forge/_generated/uiScenarios.json", serializeUiScenariosJson(ui.scenarios));
  write(root, "src/forge/_generated/uiRoutes.json", JSON.stringify(ui.routes));
  write(root, "src/forge/_generated/appGraph.json", JSON.stringify(appGraph));
  write(root, "src/forge/_generated/packageGraph.json", JSON.stringify(packageGraph));
  write(root, "src/forge/_generated/dataGraph.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", tables: [], diagnostics: [] }));
  write(root, "src/forge/_generated/runtimeGraph.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", entries: [], diagnostics: [] }));
  write(root, "src/forge/_generated/queryRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", queries: [], diagnostics: [] }));
  write(root, "src/forge/_generated/liveQueryRegistry.json", JSON.stringify({ schemaVersion: "0.1.0", liveQueries: [], diagnostics: [] }));
  write(root, "src/forge/_generated/policyRegistry.json", JSON.stringify({ policies: [], commandAuth: [], queryAuth: [], diagnostics: [] }));
  write(root, "src/forge/_generated/actionSubscriptions.json", JSON.stringify({ subscriptions: [], byEvent: {}, diagnostics: [] }));
  write(root, "src/forge/_generated/workflowRegistry.json", JSON.stringify({ workflows: [], diagnostics: [] }));
  write(root, "src/forge/_generated/workflowSubscriptions.json", JSON.stringify({ subscriptions: [], byEvent: {}, diagnostics: [] }));
  write(root, "src/forge/_generated/testGraph.json", JSON.stringify({ schemaVersion: "0.1.0", generatorVersion: "0.0.0", analyzerVersion: "test", inputHash: "hash", tests: [], diagnostics: [] }));
}

function options(root: string, overrides: Partial<UiCommandOptions> = {}): UiCommandOptions {
  return {
    subcommand: "smoke",
    workspaceRoot: root,
    json: true,
    headed: false,
    browser: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    baseUrl: "http://127.0.0.1:3000",
    runtimeUrl: "http://127.0.0.1:3765",
    reuseServers: true,
    startServers: false,
    all: false,
    changed: false,
    ci: false,
    timeoutMs: 1000,
    ...overrides,
  };
}

describe("H32 UI / browser test bridge", () => {
  test("builds deterministic UI manifest, routes, and template scenarios", () => {
    const artifacts = buildUiGeneratedArtifacts({
      appGraph,
      apiSurface,
      sources: [
        { path: "web/app/page.tsx", text: "", contentHash: "x" },
        { path: "web/app/tickets/page.tsx", text: "", contentHash: "x" },
      ],
    });

    expect(artifacts.manifest.routes.map((route) => route.path)).toContain("/tickets");
    expect(artifacts.scenarios.scenarios.map((scenario) => scenario.name)).toContain("tickets-live-update");
    expect(artifacts.scenarios.scenarios.map((scenario) => scenario.name)).toContain("policy-denied-visible");
    expect(artifacts.manifest.selectors).toContain("[data-forge-testid='ticket-list']");
  });

  test("scenario parser validates invalid steps", () => {
    const diagnostics = validateUiScenario({
      name: "bad",
      description: "bad",
      route: "tickets",
      cost: "browser",
      steps: [{ kind: "click", selector: "" }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    });

    expect(diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_SCENARIO_INVALID");
    expect(diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_SELECTOR_NOT_FOUND");
  });

  test("CLI parses ui commands and report writes last UI run", async () => {
    const root = workspace();
    writeGenerated(root);
    const parsed = parseCli(["ui", "smoke", "--scenario", "tickets-live-update", "--json", "--reuse-servers", "--browser", "chromium"]);
    expect(parsed.command).toMatchObject({
      kind: "ui",
      options: { subcommand: "smoke", scenarioName: "tickets-live-update", reuseServers: true, browser: "chromium" },
    });

    const result = await runUiCommand(options(root, { scenarioName: "tickets-live-update" }));
    expect(result.report?.scenarios[0].name).toBe("tickets-live-update");
    expect(existsSync(join(root, ".forge/ui-runs/last.json"))).toBe(true);
    expect(result.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_PLAYWRIGHT_MISSING");
  });

  test("ui audit validates generated routes and policy-denied coverage without browser", async () => {
    const root = workspace();
    writeGenerated(root);

    const result = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });

    expect(result.ok).toBe(true);
    expect(result.manifest?.routes.length).toBeGreaterThan(0);
    expect(result.scenarios?.map((scenario) => scenario.name)).toContain("policy-denied-visible");
    expect(result.diagnostics.filter((diag) => diag.severity === "error")).toEqual([]);
  });

  test("repair can diagnose from last UI run", () => {
    const root = workspace();
    const report: UiRunReport = {
      schemaVersion: "0.1.0",
      uiRunVersion: "ui-run-0.1.0",
      id: "ui_test",
      config: { baseUrl: "http://127.0.0.1:3000", runtimeUrl: "http://127.0.0.1:3765", browser: "chromium", headed: false, trace: "retain-on-failure", screenshot: "only-on-failure", video: "retain-on-failure" },
      scenarios: [{
        name: "tickets-live-update",
        ok: false,
        route: "/tickets",
        durationMs: 1,
        steps: [],
        failure: { kind: "live-query-no-update", message: "Ticket list did not update.", suggestedCommands: ["forge live status --json"] },
      }],
      summary: { ok: false, passed: 0, failed: 1, skipped: 0, durationMs: 1 },
      artifacts: { screenshots: [], traces: [], videos: [], logs: [], console: ".forge/ui-runs/ui_test/console.json", network: ".forge/ui-runs/ui_test/network.json" },
      suggestedCommands: ["forge live status --json"],
      diagnostics: [],
    };
    write(root, ".forge/ui-runs/last.json", JSON.stringify(report));

    const repaired = diagnoseRepair({
      subcommand: "diagnose",
      workspaceRoot: root,
      json: true,
      fromLastTestRun: false,
      fromLastUiRun: true,
      write: false,
      yes: false,
      keepFailed: false,
      allowMediumConfidence: false,
      maxAttempts: 1,
      commitFriendly: false,
    });

    expect(repaired.diagnosis?.failureKind).toBe("livequery-reactivity");
    expect(repaired.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_LIVE_UPDATE_TIMEOUT");
  });

  test("impact planner and review include UI evidence rules", () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "web/components/TicketList.tsx", `export function TicketList() { return null; }`);
    stage(root, "web/components/TicketList.tsx");

    const plan = buildImpactTestPlan({
      subcommand: "plan",
      workspaceRoot: root,
      json: true,
      write: false,
      changed: false,
      staged: true,
      maxCost: "browser",
      includeDocker: false,
      includeBrowser: true,
      bail: false,
    });
    expect(plan.requiredChecks.map((check) => check.command)).toContain("forge ui smoke --scenario home-loads");

    const review = runReviewCommand({
      subcommand: "run",
      workspaceRoot: root,
      json: true,
      md: false,
      sarif: false,
      write: false,
      changed: false,
      staged: true,
      mode: "standard",
      include: [],
      exclude: [],
    });
    expect(review.report?.findings.map((finding) => finding.code)).toContain("review-ui-smoke-missing");
  });
});
