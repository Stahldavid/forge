import { nodeFileSystem } from "../compiler/fs/index.ts";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { serializeCanonical } from "../compiler/primitives/serialize.ts";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import type { ApiSurface } from "../compiler/api-surface/build.ts";
import type { AppGraph, SourceFile } from "../compiler/types/app-graph.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type {
  UiCommandOptions,
  UiCommandResult,
  UiGeneratedArtifacts,
  UiRoute,
  UiRunReport,
  UiScenario,
  UiScenarioResult,
  UiScenarioStep,
  UiScenariosArtifact,
  UiTestManifest,
  UiRoutesArtifact,
} from "./types.ts";

const UI_RUN_VERSION = "ui-run-0.1.0";
const UI_RUN_DIR = ".forge/ui-runs";
const GENERATED = "src/forge/_generated";

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function diagnostic(severity: Diagnostic["severity"], code: string, message: string, file?: string): Diagnostic {
  return createDiagnostic({ severity, code, message, ...(file ? { file } : {}) });
}

function readText(workspaceRoot: string, relative: string): string {
  const absolute = join(workspaceRoot, normalize(relative));
  if (!nodeFileSystem.exists(absolute)) return "";
  return (nodeFileSystem.readText(absolute) ?? "");
}

function readJson<T>(workspaceRoot: string, relative: string, fallback: T): T {
  const text = readText(workspaceRoot, relative);
  if (!text) return fallback;
  return JSON.parse(stripDeterministicHeader(text)) as T;
}

function writeText(workspaceRoot: string, relative: string, content: string): void {
  const absolute = join(workspaceRoot, normalize(relative));
  nodeFileSystem.mkdirp(dirname(absolute));
  nodeFileSystem.writeText(absolute, content);
}

function uniqueSorted(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function walkFiles(root: string, relative = ""): string[] {
  const absolute = relative ? join(root, relative) : root;
  return nodeFileSystem.readDir(absolute).flatMap((entry) => {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    const normalized = normalize(child);
    if (entry.isDirectory) {
      if (["node_modules", ".next", ".nuxt", "dist", "build", ".vite"].includes(entry.name)) {
        return [];
      }
      return walkFiles(root, normalized);
    }
    return entry.isFile ? [normalized] : [];
  });
}

function listWebSourceFiles(workspaceRoot: string, webRoot: string): Array<{ path: string; text: string }> {
  if (!webRoot) return [];
  const absoluteWebRoot = join(workspaceRoot, normalize(webRoot));
  if (!nodeFileSystem.exists(absoluteWebRoot)) return [];
  return walkFiles(absoluteWebRoot)
    .filter((file) => /\.(tsx|jsx|vue|svelte|html)$/.test(file))
    .map((file) => {
      const path = `${normalize(webRoot)}/${file}`;
      return { path, text: readText(workspaceRoot, path) };
    })
    .filter((source) => source.text.trim().length > 0);
}

function readOptionalGeneratedJson(workspaceRoot: string, name: string): unknown {
  try {
    return readJson<unknown>(workspaceRoot, `${GENERATED}/${name}`, null);
  } catch {
    return null;
  }
}

function hasTenantScopedData(workspaceRoot: string): boolean {
  const dataGraph = readOptionalGeneratedJson(workspaceRoot, "dataGraph.json") as { tables?: Array<Record<string, unknown>> } | null;
  return (dataGraph?.tables ?? []).some((table) =>
    table?.tenantScoped === true ||
    table?.tenantScope === true ||
    typeof table?.tenantField === "string" ||
    (Array.isArray(table?.fields) && table.fields.some((field) =>
      typeof field === "object" &&
      field !== null &&
      ("tenantId" === (field as { name?: string }).name || "tenant_id" === (field as { name?: string }).name)
    ))
  );
}

function hasProductionAuthMode(workspaceRoot: string): boolean {
  const agentContract = readOptionalGeneratedJson(workspaceRoot, "agentContract.json") as { auth?: { modes?: string[]; production?: unknown } } | null;
  const modes = agentContract?.auth?.modes ?? [];
  return modes.includes("jwt") || modes.includes("oidc") || Boolean(agentContract?.auth?.production);
}

function looksLikeAuthFlow(text: string): boolean {
  return /sign\s*in|signin|login|logout|authkit|organization|tenant|session|workos|clerk|auth0/i.test(text);
}

function hasMainLandmark(text: string): boolean {
  return /<main[\s>]|role=["']main["']|<header[\s>]|<nav[\s>]/i.test(text);
}

function hasRuntimeDataHook(text: string): boolean {
  return /\b(useLiveQuery|useQuery|useForgeLiveQuery|useForgeQuery)\b/.test(text);
}

function hasStateText(text: string, pattern: RegExp): boolean {
  return pattern.test(text);
}

function findFormWithoutLabel(text: string): boolean {
  if (!/<(form|input|select|textarea)\b/i.test(text)) return false;
  const controls = text.match(/<(input|select|textarea)\b[^>]*>/gi) ?? [];
  return controls.some((control) => {
    if (/\b(type=["']?(hidden|submit|button|checkbox|radio)["']?)/i.test(control)) return false;
    if (/\b(aria-label|aria-labelledby|title)=/i.test(control)) return false;
    const id = /\bid=["']([^"']+)["']/i.exec(control)?.[1];
    if (id && new RegExp(`<label\\b[^>]*\\bfor=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(text)) {
      return false;
    }
    return !/<label\b/i.test(text);
  });
}

function findUnnamedButton(text: string): boolean {
  const buttons = text.match(/<button\b[\s\S]*?<\/button>/gi) ?? [];
  return buttons.some((button) => {
    if (/\b(aria-label|aria-labelledby|title)=/i.test(button)) return false;
    const inner = button.replace(/<button\b[^>]*>/i, "").replace(/<\/button>/i, "").replace(/<[^>]+>/g, "").trim();
    return inner.length === 0;
  });
}

function routeName(path: string): string {
  if (path === "/") return "home";
  return path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-") || "route";
}

function detectRoutesFromSources(sources: SourceFile[]): UiRoute[] {
  const routes: UiRoute[] = [];
  for (const source of sources) {
    const path = normalize(source.path);
    if (!path.startsWith("web/app/") || !path.endsWith("/page.tsx")) continue;
    const route = path
      .replace(/^web\/app/, "")
      .replace(/\/page\.tsx$/, "") || "/";
    routes.push({
      path: route,
      name: routeName(route),
      uses: {
        commands: [],
        queries: [],
        liveQueries: [],
        components: [],
      },
    });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function defaultRoutes(api: ApiSurface, sources: SourceFile[]): UiRoute[] {
  const routes = detectRoutesFromSources(sources);
  if (!routes.some((route) => route.path === "/")) {
    routes.unshift({
      path: "/",
      name: "home",
      uses: { commands: [], queries: [], liveQueries: [], components: [] },
    });
  }
  const commandNames = Object.keys(api.commands).sort();
  const liveQueryNames = Object.keys(api.liveQueries).sort();
  if (
    (commandNames.some((name) => /ticket/i.test(name)) ||
      liveQueryNames.some((name) => /ticket/i.test(name))) &&
    !routes.some((route) => route.path === "/tickets")
  ) {
    routes.push({
      path: "/tickets",
      name: "tickets",
      uses: {
        commands: commandNames.filter((name) => /ticket|billing/i.test(name)),
        queries: Object.keys(api.queries).filter((name) => /ticket/i.test(name)).sort(),
        liveQueries: liveQueryNames.filter((name) => /ticket/i.test(name)),
        components: ["TicketList", "CreateTicketForm"],
      },
    });
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path));
}

function emptyRequires(): UiScenario["requires"] {
  return {
    commands: [],
    queries: [],
    liveQueries: [],
    policies: [],
    components: [],
    workflows: [],
  };
}

function buildDefaultScenarios(api: ApiSurface, appGraph: AppGraph, routes: UiRoute[]): UiScenario[] {
  const commands = Object.keys(api.commands).sort();
  const liveQueries = Object.keys(api.liveQueries).sort();
  const workflows = Object.keys(api.workflows).sort();
  const policies = appGraph.symbols.filter((symbol) => symbol.kind === "policy").map((symbol) => symbol.name).sort();
  const scenarios: UiScenario[] = [
    {
      name: "home-loads",
      description: "Load the home route and verify the app renders.",
      route: "/",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/" },
        { kind: "expectVisible", selector: "[data-forge-testid='app-root'], body" },
      ],
      requires: emptyRequires(),
    },
  ];

  if (routes.some((route) => route.path === "/tickets")) {
    scenarios.push({
      name: "tickets-page-loads",
      description: "Load the tickets page and verify the generated form/list selectors.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "expectVisible", selector: "[data-forge-testid='ticket-title-input']" },
        { kind: "expectVisible", selector: "[data-forge-testid='ticket-list']" },
      ],
      requires: {
        ...emptyRequires(),
        components: ["CreateTicketForm", "TicketList"],
      },
    });
    scenarios.push({
      name: "tickets-live-update",
      description: "Create a ticket and verify liveQuery updates the ticket list.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "fill", selector: "[data-forge-testid='ticket-title-input']", value: "Ticket from UI smoke" },
        { kind: "click", selector: "[data-forge-testid='create-ticket-button']" },
        { kind: "expectText", selector: "[data-forge-testid='ticket-list']", text: "Ticket from UI smoke", timeoutMs: 5000 },
        { kind: "waitForLiveRevision", minRevision: 1, timeoutMs: 5000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /create.*ticket|ticket.*create/i.test(name)),
        liveQueries: liveQueries.filter((name) => /ticket/i.test(name)),
        policies: policies.filter((name) => /tickets\.(create|read)/i.test(name)),
        components: ["CreateTicketForm", "TicketList"],
      },
    });
    scenarios.push({
      name: "policy-denied-visible",
      description: "Verify policy denied errors surface with a traceId.",
      route: "/tickets",
      cost: "browser",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "click", selector: "[data-forge-testid='billing-manage-demo']" },
        { kind: "expectText", selector: "[data-forge-testid='policy-denied-error']", text: "FORGE_POLICY_DENIED", timeoutMs: 5000 },
        { kind: "expectText", selector: "[data-forge-testid='policy-denied-error']", text: "trace", timeoutMs: 5000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /billing/i.test(name)),
        policies: policies.filter((name) => /billing\.manage/i.test(name)),
        components: ["TicketList"],
      },
    });
  }

  if (workflows.some((name) => /triage|ai/i.test(name))) {
    scenarios.push({
      name: "ai-triage-mock-visible",
      description: "Create a ticket and verify AI mock workflow output appears.",
      route: "/tickets",
      cost: "slow",
      steps: [
        { kind: "goto", path: "/tickets" },
        { kind: "fill", selector: "[data-forge-testid='ticket-title-input']", value: "AI triage smoke" },
        { kind: "click", selector: "[data-forge-testid='create-ticket-button']" },
        { kind: "expectVisible", selector: "[data-forge-testid='triage-summary']", timeoutMs: 10000 },
      ],
      requires: {
        ...emptyRequires(),
        commands: commands.filter((name) => /ticket/i.test(name)),
        liveQueries: liveQueries.filter((name) => /ticket/i.test(name)),
        workflows: workflows.filter((name) => /triage|ai/i.test(name)),
        components: ["TicketList"],
      },
    });
  }

  return scenarios.sort((a, b) => a.name.localeCompare(b.name));
}

export function buildUiGeneratedArtifacts(input: {
  appGraph: AppGraph;
  apiSurface: ApiSurface;
  sources: SourceFile[];
}): UiGeneratedArtifacts {
  const routes = defaultRoutes(input.apiSurface, input.sources);
  const scenarios = buildDefaultScenarios(input.apiSurface, input.appGraph, routes);
  const manifest: UiTestManifest = {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    framework: input.sources.some((source) => source.path.startsWith("web/app/")) ? "next" : "unknown",
    webRoot: input.sources.some((source) => source.path.startsWith("web/")) ? "web" : "",
    defaultBaseUrl: "http://127.0.0.1:3000",
    runtimeUrl: "http://127.0.0.1:3765",
    routes,
    scenarios: scenarios.map((scenario) => scenario.name),
    selectors: uniqueSorted(
      scenarios.flatMap((scenario) =>
        scenario.steps.flatMap((step) =>
          "selector" in step ? [step.selector] : [],
        ),
      ),
    ),
  };
  return {
    manifest,
    scenarios: { schemaVersion: "0.1.0", scenarios },
    routes: { schemaVersion: "0.1.0", routes },
  };
}

export function serializeUiTestManifestJson(manifest: UiTestManifest): string {
  return serializeCanonical(manifest);
}

export function serializeUiTestManifestTs(manifest: UiTestManifest): string {
  return `export const uiTestManifest = ${JSON.stringify(JSON.parse(serializeUiTestManifestJson(manifest)), null, 2)} as const;\n`;
}

export function serializeUiScenariosJson(scenarios: UiScenariosArtifact): string {
  return serializeCanonical(scenarios);
}

export function serializeUiScenariosTs(scenarios: UiScenariosArtifact): string {
  return `export const uiScenarios = ${JSON.stringify(JSON.parse(serializeUiScenariosJson(scenarios)), null, 2)} as const;\n`;
}

export function serializeUiRoutesJson(routes: UiRoutesArtifact): string {
  return serializeCanonical(routes);
}

export function serializeUiRoutesTs(routes: UiRoutesArtifact): string {
  return `export const uiRoutes = ${JSON.stringify(JSON.parse(serializeUiRoutesJson(routes)), null, 2)} as const;\n`;
}

export function validateUiScenario(scenario: UiScenario): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!scenario.name) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", "scenario name is required"));
  }
  if (!scenario.route.startsWith("/")) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", `scenario ${scenario.name} route must start with /`));
  }
  if (scenario.steps.length === 0) {
    diagnostics.push(diagnostic("error", "FORGE_UI_SCENARIO_INVALID", `scenario ${scenario.name} has no steps`));
  }
  for (const [index, step] of scenario.steps.entries()) {
    if ("selector" in step && !step.selector) {
      diagnostics.push(diagnostic("error", "FORGE_UI_SELECTOR_NOT_FOUND", `scenario ${scenario.name} step ${index + 1} selector is empty`));
    }
    if (step.kind === "goto" && !step.path.startsWith("/")) {
      diagnostics.push(diagnostic("error", "FORGE_UI_ROUTE_FAILED", `scenario ${scenario.name} goto path must start with /`));
    }
  }
  return diagnostics;
}

function loadUiManifest(workspaceRoot: string): UiTestManifest {
  return readJson<UiTestManifest>(workspaceRoot, `${GENERATED}/uiTestManifest.json`, {
    schemaVersion: "0.1.0",
    generatorVersion: GENERATOR_VERSION,
    framework: "unknown",
    webRoot: "",
    defaultBaseUrl: "http://127.0.0.1:3000",
    runtimeUrl: "http://127.0.0.1:3765",
    routes: [{ path: "/", name: "home", uses: { commands: [], queries: [], liveQueries: [], components: [] } }],
    scenarios: ["home-loads"],
    selectors: ["body"],
  });
}

function loadUiScenarios(workspaceRoot: string): UiScenario[] {
  return readJson<UiScenariosArtifact>(workspaceRoot, `${GENERATED}/uiScenarios.json`, {
    schemaVersion: "0.1.0",
    scenarios: [{
      name: "home-loads",
      description: "Load the home route.",
      route: "/",
      cost: "browser",
      steps: [{ kind: "goto", path: "/" }, { kind: "expectVisible", selector: "body" }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }],
  }).scenarios;
}

function scenarioFailure(name: string, route: string, message: string): UiScenarioResult {
  return {
    name,
    ok: false,
    route,
    durationMs: 0,
    steps: [],
    failure: {
      kind: "playwright-missing",
      message,
      suggestedCommands: [
        "bun add -d @playwright/test",
        "bunx playwright install",
        "forge ui doctor --json",
      ],
    },
  };
}

function suggestedCommands(results: UiScenarioResult[]): string[] {
  const commands = new Set<string>([
    "forge ui doctor --json",
    "forge review --changed",
  ]);
  for (const result of results) {
    if (result.failure?.kind === "live-query-no-update") {
      commands.add("forge live status --json");
      commands.add("forge live invalidations --json");
      commands.add("forge repair diagnose --from-last-ui-run --json");
    }
    if (result.traceId) {
      commands.add(`forge telemetry inspect ${result.traceId} --json`);
      commands.add(`forge repair diagnose --trace ${result.traceId} --json`);
    }
    for (const command of result.failure?.suggestedCommands ?? []) {
      commands.add(command);
    }
  }
  return [...commands].sort();
}

function makeRunId(input: unknown): string {
  return `ui_${hashStable(JSON.stringify(input)).slice(0, 12)}`;
}

function emptyReport(options: UiCommandOptions, scenarios: UiScenario[], diagnostics: Diagnostic[], started: number): UiRunReport {
  const results = scenarios.map((scenario) =>
    scenarioFailure(scenario.name, scenario.route, "Playwright is not installed; run forge ui doctor for setup details."),
  );
  const failed = results.length;
  const report: UiRunReport = {
    schemaVersion: "0.1.0",
    uiRunVersion: UI_RUN_VERSION,
    id: makeRunId({ scenarios: scenarios.map((scenario) => scenario.name), diagnostics: diagnostics.map((item) => item.code) }),
    config: {
      baseUrl: options.baseUrl,
      runtimeUrl: options.runtimeUrl,
      browser: options.browser,
      headed: options.headed,
      trace: options.trace,
      screenshot: options.screenshot,
      video: options.video,
    },
    scenarios: results,
    summary: {
      ok: false,
      passed: 0,
      failed,
      skipped: 0,
      durationMs: Date.now() - started,
    },
    artifacts: {
      screenshots: [],
      traces: [],
      videos: [],
      logs: [],
      console: `${UI_RUN_DIR}/last/console.json`,
      network: `${UI_RUN_DIR}/last/network.json`,
    },
    suggestedCommands: [],
    diagnostics,
  };
  report.suggestedCommands = suggestedCommands(results);
  return report;
}

async function importPlaywright(): Promise<unknown | null> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return await dynamicImport("playwright");
  } catch {
    return null;
  }
}

async function runWithPlaywright(options: UiCommandOptions, scenarios: UiScenario[], started: number): Promise<UiRunReport> {
  const playwright = await importPlaywright() as Record<string, { launch: (options: { headless: boolean }) => Promise<unknown> }> | null;
  if (!playwright || !playwright[options.browser]) {
    const diag = diagnostic("error", "FORGE_UI_PLAYWRIGHT_MISSING", "Playwright is not installed. Add @playwright/test/playwright and install browsers.");
    return emptyReport(options, scenarios, [diag], started);
  }

  // The real adapter is intentionally small: declarative scenarios are executed
  // through Playwright when the package is available. Unit tests keep this path
  // behind optional dependency detection.
  const browser = await playwright[options.browser].launch({ headless: !options.headed }) as {
    newPage: () => Promise<{
      goto: (url: string, options?: { timeout?: number }) => Promise<unknown>;
      click: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
      fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
      waitForSelector: (selector: string, options?: { timeout?: number; state?: string }) => Promise<unknown>;
      textContent: (selector: string, options?: { timeout?: number }) => Promise<string | null>;
      screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
      close: () => Promise<void>;
    }>;
    close: () => Promise<void>;
  };
  const results: UiScenarioResult[] = [];
  const screenshots: string[] = [];
  for (const scenario of scenarios) {
    const scenarioStarted = Date.now();
    const steps: UiScenarioResult["steps"] = [];
    const page = await browser.newPage();
    let failed: UiScenarioResult["failure"];
    try {
      for (const step of scenario.steps) {
        const stepStarted = Date.now();
        await executeStep(page, options, step);
        steps.push({ kind: step.kind, ok: true, durationMs: Date.now() - stepStarted });
      }
    } catch (error) {
      const screenshot = `${UI_RUN_DIR}/${makeRunId(scenario.name)}/screenshots/failure-${scenario.name}.png`;
      const absolute = join(options.workspaceRoot, screenshot);
      nodeFileSystem.mkdirp(dirname(absolute));
      try {
        await page.screenshot({ path: absolute, fullPage: true });
        screenshots.push(screenshot);
      } catch {
        // Screenshot failures are surfaced by the main failure message.
      }
      failed = {
        kind: "expected-text-missing",
        message: error instanceof Error ? error.message : "UI scenario failed",
        screenshot,
        suggestedCommands: ["forge ui report last", "forge repair diagnose --from-last-ui-run --json"],
      };
    } finally {
      await page.close();
    }
    results.push({
      name: scenario.name,
      ok: !failed,
      route: scenario.route,
      durationMs: Date.now() - scenarioStarted,
      steps,
      failure: failed,
    });
  }
  await browser.close();
  return buildReportFromResults(options, results, [], screenshots, started);
}

async function executeStep(page: {
  goto: (url: string, options?: { timeout?: number }) => Promise<unknown>;
  click: (selector: string, options?: { timeout?: number }) => Promise<unknown>;
  fill: (selector: string, value: string, options?: { timeout?: number }) => Promise<unknown>;
  waitForSelector: (selector: string, options?: { timeout?: number; state?: string }) => Promise<unknown>;
  textContent: (selector: string, options?: { timeout?: number }) => Promise<string | null>;
  screenshot: (options: { path: string; fullPage?: boolean }) => Promise<unknown>;
}, options: UiCommandOptions, step: UiScenarioStep): Promise<void> {
  if (step.kind === "goto") {
    await page.goto(new URL(step.path, options.baseUrl).toString(), { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "click") {
    await page.click(step.selector, { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "fill") {
    await page.fill(step.selector, step.value, { timeout: options.timeoutMs });
    return;
  }
  if (step.kind === "expectVisible") {
    await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs, state: "visible" });
    return;
  }
  if (step.kind === "expectNotVisible") {
    await page.waitForSelector(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs, state: "hidden" });
    return;
  }
  if (step.kind === "expectText") {
    const text = await page.textContent(step.selector, { timeout: step.timeoutMs ?? options.timeoutMs });
    if (!text?.includes(step.text)) {
      throw new Error(`Expected ${step.selector} to contain '${step.text}'`);
    }
    return;
  }
  if (step.kind === "captureScreenshot") {
    const path = `${UI_RUN_DIR}/snapshots/${step.name}.png`;
    const absolute = join(options.workspaceRoot, path);
    nodeFileSystem.mkdirp(dirname(absolute));
    await page.screenshot({ path: absolute, fullPage: true });
  }
}

function buildReportFromResults(
  options: UiCommandOptions,
  results: UiScenarioResult[],
  diagnostics: Diagnostic[],
  screenshots: string[],
  started: number,
): UiRunReport {
  const failed = results.filter((result) => !result.ok).length;
  const passed = results.filter((result) => result.ok).length;
  const report: UiRunReport = {
    schemaVersion: "0.1.0",
    uiRunVersion: UI_RUN_VERSION,
    id: makeRunId({ scenarios: results.map((result) => result.name), failed, passed }),
    config: {
      baseUrl: options.baseUrl,
      runtimeUrl: options.runtimeUrl,
      browser: options.browser,
      headed: options.headed,
      trace: options.trace,
      screenshot: options.screenshot,
      video: options.video,
    },
    scenarios: results,
    summary: {
      ok: failed === 0 && diagnostics.every((item) => item.severity !== "error"),
      passed,
      failed,
      skipped: 0,
      durationMs: Date.now() - started,
    },
    artifacts: {
      screenshots,
      traces: [],
      videos: [],
      logs: [],
      console: `${UI_RUN_DIR}/last/console.json`,
      network: `${UI_RUN_DIR}/last/network.json`,
    },
    suggestedCommands: suggestedCommands(results),
    diagnostics,
  };
  return report;
}

function renderReportMarkdown(report: UiRunReport): string {
  return `# Forge UI Run

Run: ${report.id}
OK: ${report.summary.ok ? "yes" : "no"}
Passed: ${report.summary.passed}
Failed: ${report.summary.failed}

## Scenarios

${report.scenarios.map((scenario) => `- ${scenario.ok ? "OK" : "FAIL"} ${scenario.name}${scenario.failure ? `: ${scenario.failure.message}` : ""}`).join("\n") || "- none"}

## Suggested Commands

\`\`\`bash
${report.suggestedCommands.join("\n")}
\`\`\`
`;
}

export function writeUiReport(workspaceRoot: string, report: UiRunReport): void {
  const dir = `${UI_RUN_DIR}/${report.id}`;
  writeText(workspaceRoot, `${dir}/report.json`, serializeCanonical(report));
  writeText(workspaceRoot, `${dir}/report.md`, renderReportMarkdown(report));
  writeText(workspaceRoot, `${dir}/console.json`, "[]\n");
  writeText(workspaceRoot, `${dir}/network.json`, "[]\n");
  writeText(workspaceRoot, `${UI_RUN_DIR}/last.json`, serializeCanonical(report));
}

function selectScenarios(options: UiCommandOptions, scenarios: UiScenario[]): UiScenario[] {
  if (options.subcommand === "route") {
    const path = options.routePath ?? "/";
    return [{
      name: `route-${routeName(path)}`,
      description: `Load route ${path}`,
      route: path,
      cost: "browser",
      steps: [{ kind: "goto", path }, { kind: "expectVisible", selector: "body" }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }];
  }
  if (options.subcommand === "snapshot") {
    const path = options.routePath ?? "/";
    return [{
      name: options.snapshotName ?? `snapshot-${routeName(path)}`,
      description: `Capture snapshot for ${path}`,
      route: path,
      cost: "browser",
      steps: [{ kind: "goto", path }, { kind: "captureScreenshot", name: options.snapshotName ?? routeName(path) }],
      requires: { commands: [], queries: [], liveQueries: [], policies: [], components: [], workflows: [] },
    }];
  }
  if (options.scenarioName) {
    return scenarios.filter((scenario) => scenario.name === options.scenarioName);
  }
  if (options.subcommand === "smoke") {
    return scenarios.filter((scenario) => scenario.cost === "browser").slice(0, 4);
  }
  return options.all ? scenarios : scenarios.slice(0, 1);
}

export async function runUiCommand(options: UiCommandOptions): Promise<UiCommandResult> {
  if (options.subcommand === "audit") {
    return runUiAudit(options);
  }
  if (options.subcommand === "doctor") {
    return runUiDoctor(options);
  }
  if (options.subcommand === "list") {
    const scenarios = loadUiScenarios(options.workspaceRoot);
    return { ok: true, manifest: loadUiManifest(options.workspaceRoot), scenarios, diagnostics: [], exitCode: 0 };
  }
  if (options.subcommand === "report") {
    return readUiReport(options.workspaceRoot, options.reportId ?? "last");
  }

  const started = Date.now();
  const allScenarios = loadUiScenarios(options.workspaceRoot);
  const selected = selectScenarios(options, allScenarios);
  const validation = selected.flatMap(validateUiScenario);
  if (validation.some((item) => item.severity === "error")) {
    const report = emptyReport(options, selected, validation, started);
    writeUiReport(options.workspaceRoot, report);
    return { ok: false, report, diagnostics: validation, exitCode: 1 };
  }
  const report = await runWithPlaywright(options, selected, started);
  writeUiReport(options.workspaceRoot, report);
  return {
    ok: report.summary.ok,
    report,
    diagnostics: report.diagnostics,
    exitCode: report.summary.ok ? 0 : 1,
  };
}

function runUiAudit(options: UiCommandOptions): UiCommandResult {
  const manifest = loadUiManifest(options.workspaceRoot);
  const scenarios = loadUiScenarios(options.workspaceRoot);
  const diagnostics: Diagnostic[] = [];
  const webSources = listWebSourceFiles(options.workspaceRoot, manifest.webRoot);
  const webText = webSources.map((source) => source.text).join("\n");
  const scenarioRoutes = new Set(scenarios.map((scenario) => scenario.route));
  const scenarioNames = scenarios.map((scenario) => scenario.name);
  const selectorSet = new Set(manifest.selectors);

  if (manifest.routes.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", "No frontend routes are present in uiTestManifest."));
  }
  if (manifest.routes.length > 0 && scenarios.length === 0) {
    diagnostics.push(diagnostic("error", "FORGE_UI_TESTID_MISSING", "Frontend routes exist but no UI scenarios were generated."));
  }
  for (const route of manifest.routes) {
    if (!scenarioRoutes.has(route.path)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", `No UI scenario covers route '${route.path}'.`));
    }
    const usesRuntime = route.uses.commands.length > 0 || route.uses.queries.length > 0 || route.uses.liveQueries.length > 0;
    if (usesRuntime && selectorSet.size === 0) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", `Route '${route.path}' uses Forge runtime bindings but no stable data-forge-testid selectors were detected.`));
    }
  }
  const hasPolicySensitiveRuntime = scenarios.some((scenario) =>
    scenario.requires.policies.length > 0 || scenario.requires.commands.length > 0
  );
  if (hasPolicySensitiveRuntime && !scenarioNames.some((name) => name.includes("policy-denied"))) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_POLICY_ERROR_MISSING", "Policy-sensitive UI flows should include a visible policy-denied scenario."));
  }
  if (manifest.routes.length > 0 && !manifest.selectors.some((selector) => selector.includes("data-forge-testid"))) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", "No data-forge-testid selectors were captured for UI smoke/audit stability."));
  }
  if (manifest.webRoot && manifest.routes.length > 0 && webSources.length === 0) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_SOURCE_MISSING", `No frontend source files were found under '${manifest.webRoot}' for static UX audit.`));
  }
  if (webSources.length > 0 && !webSources.some((source) => hasMainLandmark(source.text))) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_LANDMARK_MISSING", "Frontend source does not appear to include a main/header/nav landmark; add semantic landmarks for scanning and accessibility."));
  }
  for (const source of webSources) {
    if (findFormWithoutLabel(source.text)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_FORM_LABEL_MISSING", "Form controls should have labels or aria-label/aria-labelledby for accessible testing and real users.", source.path));
    }
    if (findUnnamedButton(source.text)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_BUTTON_NAME_MISSING", "Icon-only or empty buttons should include aria-label/title text.", source.path));
    }
  }
  if (webSources.some((source) => hasRuntimeDataHook(source.text))) {
    if (!hasStateText(webText, /\b(isLoading|loading|pending|skeleton|spinner|carregando|loading\.\.\.)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_LOADING_STATE_MISSING", "Forge data-bound UI should expose a loading or pending state."));
    }
    if (!hasStateText(webText, /\b(error|erro|failed|failure|FORGE_|traceId|trace)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_ERROR_STATE_MISSING", "Forge data-bound UI should surface runtime/policy errors with enough context to debug."));
    }
    if (!hasStateText(webText, /\b(empty|no\s+\w+|none|vazio|sem\s+\w+|length\s*===\s*0)\b/i)) {
      diagnostics.push(diagnostic("warning", "FORGE_UI_EMPTY_STATE_MISSING", "Forge data-bound UI should include an empty state so first-run apps do not look broken."));
    }
  }
  if ((hasTenantScopedData(options.workspaceRoot) || hasProductionAuthMode(options.workspaceRoot)) && webSources.length > 0 && !looksLikeAuthFlow(webText)) {
    diagnostics.push(diagnostic(
      "warning",
      "FORGE_UI_AUTH_FLOW_MISSING",
      "Tenant-scoped or production-auth app has no obvious sign-in/session/organization UI; local devAuth is not a production auth flow.",
    ));
  }

  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    manifest,
    scenarios,
    diagnostics,
    exitCode: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}

function runUiDoctor(options: UiCommandOptions): UiCommandResult {
  const manifest = loadUiManifest(options.workspaceRoot);
  const diagnostics: Diagnostic[] = [];
  const checks = [
    nodeFileSystem.exists(join(options.workspaceRoot, "node_modules/playwright")) ||
      nodeFileSystem.exists(join(options.workspaceRoot, "node_modules/@playwright/test")),
    manifest.routes.length > 0,
    manifest.scenarios.length > 0,
  ];
  if (!checks[0]) {
    diagnostics.push(diagnostic("error", "FORGE_UI_PLAYWRIGHT_MISSING", "Playwright is not installed; run bun add -d @playwright/test && bunx playwright install."));
  }
  if (!checks[1]) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_ROUTE_FAILED", "No UI routes are present in uiTestManifest."));
  }
  if (!checks[2]) {
    diagnostics.push(diagnostic("warning", "FORGE_UI_TESTID_MISSING", "No UI scenarios are present in uiScenarios."));
  }
  return {
    ok: diagnostics.every((item) => item.severity !== "error"),
    manifest,
    diagnostics,
    exitCode: diagnostics.some((item) => item.severity === "error") ? 1 : 0,
  };
}

function readUiReport(workspaceRoot: string, id: string): UiCommandResult {
  const path =
    id === "last"
      ? `${UI_RUN_DIR}/last.json`
      : `${UI_RUN_DIR}/${id}/report.json`;
  const absolute = join(workspaceRoot, path);
  if (!nodeFileSystem.exists(absolute)) {
    const diag = diagnostic("error", "FORGE_UI_REPORT_NOT_FOUND", `UI report not found: ${id}`, path);
    return { ok: false, diagnostics: [diag], exitCode: 1 };
  }
  const report = JSON.parse((nodeFileSystem.readText(absolute) ?? "")) as UiRunReport;
  return { ok: report.summary.ok, report, diagnostics: report.diagnostics, exitCode: report.summary.ok ? 0 : 1 };
}

export function listUiRuns(workspaceRoot: string): Array<{ id: string; path: string }> {
  const dir = join(workspaceRoot, UI_RUN_DIR);
  if (!nodeFileSystem.exists(dir)) return [];
  return nodeFileSystem
    .readDir(dir)
    .filter((entry) => entry.isDirectory)
    .map((entry) => ({ id: entry.name, path: `${UI_RUN_DIR}/${entry.name}/report.json` }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function formatUiJson(result: UiCommandResult): string {
  if (result.report) {
    return `${JSON.stringify(result.report, null, 2)}\n`;
  }
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatUiHuman(result: UiCommandResult): string {
  if (result.report) {
    return renderReportMarkdown(result.report);
  }
  if (result.scenarios) {
    return `Forge UI Scenarios

${result.scenarios.map((scenario) => `- ${scenario.name}: ${scenario.route}`).join("\n")}
`;
  }
  if (result.manifest) {
    return `Forge UI Doctor

${result.diagnostics.map((diag) => `${diag.severity} ${diag.code}: ${diag.message}`).join("\n") || "OK"}
`;
  }
  return `${result.diagnostics.map((diag) => `${diag.severity} ${diag.code}: ${diag.message}`).join("\n")}\n`;
}

export function runUiListCommand(workspaceRoot: string): UiCommandResult {
  return {
    ok: true,
    reports: listUiRuns(workspaceRoot),
    diagnostics: [],
    exitCode: 0,
  };
}

export function runForgeCommandForUi(workspaceRoot: string, command: string): { ok: boolean; output: string } {
  const parts = command.split(/\s+/).filter(Boolean);
  const result = spawnSync(parts[0], parts.slice(1), {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}
