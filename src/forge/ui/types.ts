import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import type { TestCost } from "../compiler/types/test-graph.ts";

export type UiSubcommand =
  | "audit"
  | "smoke"
  | "test"
  | "scenario"
  | "route"
  | "snapshot"
  | "report"
  | "doctor"
  | "list";

export type UiBrowserName = "chromium" | "firefox" | "webkit";
export type UiTraceMode = "on" | "off" | "retain-on-failure";
export type UiScreenshotMode = "on" | "off" | "only-on-failure";
export type UiVideoMode = "on" | "off" | "retain-on-failure";

export interface UiCommandOptions {
  subcommand: UiSubcommand;
  workspaceRoot: string;
  json: boolean;
  headed: boolean;
  browser: UiBrowserName;
  trace: UiTraceMode;
  screenshot: UiScreenshotMode;
  video: UiVideoMode;
  baseUrl: string;
  runtimeUrl: string;
  reuseServers: boolean;
  startServers: boolean;
  scenarioName?: string;
  routePath?: string;
  snapshotName?: string;
  reportId?: string;
  all: boolean;
  changed: boolean;
  ci: boolean;
  timeoutMs: number;
  authToken?: string;
}

export type UiScenarioStep =
  | { kind: "goto"; path: string }
  | { kind: "click"; selector: string }
  | { kind: "fill"; selector: string; value: string }
  | { kind: "expectText"; selector: string; text: string; timeoutMs?: number }
  | { kind: "expectVisible"; selector: string; timeoutMs?: number }
  | { kind: "expectNotVisible"; selector: string; timeoutMs?: number }
  | { kind: "waitForLiveRevision"; minRevision: number; timeoutMs?: number }
  | { kind: "captureScreenshot"; name: string }
  | { kind: "runForgeCommand"; command: string };

export interface UiScenarioRequires {
  commands: string[];
  queries: string[];
  liveQueries: string[];
  policies: string[];
  components: string[];
  workflows: string[];
}

export interface UiScenario {
  name: string;
  description: string;
  route: string;
  cost: TestCost;
  steps: UiScenarioStep[];
  requires: UiScenarioRequires;
}

export interface UiRoute {
  path: string;
  name: string;
  uses: {
    commands: string[];
    queries: string[];
    liveQueries: string[];
    components: string[];
  };
}

export interface UiTestManifest {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  framework: "next" | "react" | "unknown";
  webRoot: string;
  defaultBaseUrl: string;
  runtimeUrl: string;
  routes: UiRoute[];
  scenarios: string[];
  selectors: string[];
}

export interface UiScenariosArtifact {
  schemaVersion: "0.1.0";
  scenarios: UiScenario[];
}

export interface UiRoutesArtifact {
  schemaVersion: "0.1.0";
  routes: UiRoute[];
}

export type UiFailureKind =
  | "route-load-failed"
  | "selector-not-found"
  | "expected-text-missing"
  | "command-failed"
  | "live-query-no-update"
  | "policy-denied-unexpected"
  | "browser-console-error"
  | "network-error"
  | "timeout"
  | "playwright-missing";

export interface UiStepResult {
  kind: UiScenarioStep["kind"];
  ok: boolean;
  durationMs: number;
  message?: string;
  selector?: string;
}

export interface UiScenarioResult {
  name: string;
  ok: boolean;
  route?: string;
  durationMs: number;
  steps: UiStepResult[];
  traceId?: string;
  failure?: {
    kind: UiFailureKind;
    message: string;
    screenshot?: string;
    trace?: string;
    video?: string;
    suggestedCommands: string[];
  };
}

export interface UiRunReport {
  schemaVersion: "0.1.0";
  uiRunVersion: string;
  id: string;
  startedAt?: string;
  completedAt?: string;
  config: {
    baseUrl: string;
    runtimeUrl: string;
    browser: UiBrowserName;
    headed: boolean;
    trace: UiTraceMode;
    screenshot: UiScreenshotMode;
    video: UiVideoMode;
  };
  scenarios: UiScenarioResult[];
  summary: {
    ok: boolean;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number;
  };
  artifacts: {
    screenshots: string[];
    traces: string[];
    videos: string[];
    logs: string[];
    console: string;
    network: string;
  };
  suggestedCommands: string[];
  diagnostics: Diagnostic[];
}

export interface UiCommandResult {
  ok: boolean;
  report?: UiRunReport;
  reports?: Array<{ id: string; path: string }>;
  manifest?: UiTestManifest;
  scenarios?: UiScenario[];
  diagnostics: Diagnostic[];
  exitCode: 0 | 1;
}

export interface UiGeneratedArtifacts {
  manifest: UiTestManifest;
  scenarios: UiScenariosArtifact;
  routes: UiRoutesArtifact;
}
