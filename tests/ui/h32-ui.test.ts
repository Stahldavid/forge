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

  test("ui doctor suggests npm Playwright setup for npm workspaces", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "package.json", JSON.stringify({ scripts: { dev: "vite" }, devDependencies: {} }));
    write(root, "package-lock.json", "{}\n");

    const result = await runUiCommand({
      ...options(root),
      subcommand: "doctor",
    });
    const missing = result.diagnostics.find((diag) => diag.code === "FORGE_UI_PLAYWRIGHT_MISSING");

    expect(result.ok).toBe(false);
    expect(missing?.suggestedCommands).toContain("npm install -D @playwright/test");
    expect(missing?.suggestedCommands).toContain("npx playwright install");
  });

  test("ui doctor uses web package manager when frontend has its own package root", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "web/package.json", JSON.stringify({ devDependencies: { "@playwright/test": "^1.0.0" } }));
    write(root, "web/pnpm-lock.yaml", "lockfileVersion: '9.0'\n");

    const result = await runUiCommand({
      ...options(root),
      subcommand: "doctor",
    });
    const missing = result.diagnostics.find((diag) => diag.code === "FORGE_UI_PLAYWRIGHT_MISSING");

    expect(result.ok).toBe(false);
    expect(missing?.message).toContain("web");
    expect(missing?.suggestedCommands).toContain("cd web");
    expect(missing?.suggestedCommands).toContain("pnpm install");
    expect(missing?.suggestedCommands).toContain("pnpm exec playwright install");
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

  test("ui audit reports static UX and production-auth readiness warnings", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/dataGraph.json", JSON.stringify({
      schemaVersion: "0.1.0",
      generatorVersion: "0.0.0",
      analyzerVersion: "test",
      inputHash: "hash",
      tables: [{
        table: "projects",
        fields: [{ name: "id", type: "text" }, { name: "tenantId", type: "text" }],
      }],
      diagnostics: [],
    }));
    write(root, "src/forge/_generated/agentContract.json", JSON.stringify({
      schemaVersion: "0.1.0",
      auth: { modes: ["dev-headers", "jwt"] },
    }));
    write(root, "src/forge/_generated/integrations/workos/authkit.ts", "export const workosAuthKitEnv = {};\n");
    write(root, "src/forge/_generated/integrations/workos/auth-routes.ts", "export const workosAuthHttpRoutes = [];\n");
    write(root, "web/package.json", JSON.stringify({ dependencies: { react: "^19.0.0" } }));
    write(root, "web/app/page.tsx", `
      import { useLiveQuery } from "../src/lib/forge";

      export default function Page() {
        const board = useLiveQuery("liveTickets", {});
        return (
          <div>
            <form>
              <input name="email" />
              <button><span /></button>
            </form>
            <pre>{JSON.stringify(board.data)}</pre>
          </div>
        );
      }
    `);

    const result = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const codes = result.diagnostics.map((diag) => diag.code);

    expect(result.ok).toBe(true);
    expect(codes).toContain("FORGE_UI_AUTH_FLOW_MISSING");
    expect(codes).toContain("FORGE_UI_LANDMARK_MISSING");
    expect(codes).toContain("FORGE_UI_FORM_LABEL_MISSING");
    expect(codes).toContain("FORGE_UI_BUTTON_NAME_MISSING");
    expect(codes).toContain("FORGE_UI_LOADING_STATE_MISSING");
    expect(codes).toContain("FORGE_UI_ERROR_STATE_MISSING");
    expect(codes).toContain("FORGE_UI_EMPTY_STATE_MISSING");
    expect(codes).toContain("FORGE_UI_WORKOS_AUTHKIT_MISSING");
  });

  test("ui audit requires WorkOS browser session claims and route proxy", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/integrations/workos/authkit.ts", "export const workosAuthKitEnv = {};\n");
    write(root, "src/forge/_generated/integrations/workos/auth-routes.ts", "export const workosAuthHttpRoutes = [];\n");
    write(root, "web/package.json", JSON.stringify({
      dependencies: {
        "@workos-inc/authkit-react": "^1.0.0",
        react: "^19.0.0",
      },
    }));
    write(root, "web/app/page.tsx", `
      import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
      import { ForgeProvider } from "../src/lib/forge";

      function Shell() {
        const { getAccessToken } = useAuth();
        return (
          <ForgeProvider getToken={getAccessToken}>
            <main>
              <nav><a href="#requests">Requests</a></nav>
              <section id="requests">
                <h1>Vendor access</h1>
                <button type="button">Request access</button>
                <p>Signed in organization</p>
              </section>
            </main>
          </ForgeProvider>
        );
      }

      export default function Page() {
        return <AuthKitProvider clientId="client_test"><Shell /></AuthKitProvider>;
      }
    `);

    const missingSession = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const missingCodes = missingSession.diagnostics.map((diag) => diag.code);

    expect(missingSession.ok).toBe(true);
    expect(missingCodes).not.toContain("FORGE_UI_WORKOS_AUTHKIT_MISSING");
    expect(missingCodes).toContain("FORGE_UI_WORKOS_SESSION_MISSING");

    write(root, "web/src/lib/workos-auth.tsx", `
      export function useForgeWorkOSSession() {
        return fetch("/session")
          .then((response) => response.json())
          .then((session) => ({
            claims: session.claims,
            organizationId: session.claims.organization_id,
            role: session.claims.role,
            permissions: session.claims.permissions,
          }));
      }
    `);
    write(root, "web/vite.config.ts", `
      export default {
        server: {
          proxy: {
            "/login": "http://127.0.0.1:3765",
            "/callback": "http://127.0.0.1:3765",
            "/logout": "http://127.0.0.1:3765",
            "/session": "http://127.0.0.1:3765",
          },
        },
      };
    `);

    const wiredSession = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const wiredCodes = wiredSession.diagnostics.map((diag) => diag.code);

    expect(wiredSession.ok).toBe(true);
    expect(wiredCodes).not.toContain("FORGE_UI_WORKOS_SESSION_MISSING");
  });

  test("ui audit requires a visible WorkOS sign-in or sign-out path", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/integrations/workos/authkit.ts", "export const workosAuthKitEnv = {};\n");
    write(root, "src/forge/_generated/integrations/workos/auth-routes.ts", "export const workosAuthHttpRoutes = [];\n");
    write(root, "web/app/page.tsx", `
      export default function Page() {
        return (
          <main>
            <nav><a href="#queue">Queue</a></nav>
            <section id="queue">
              <h1>Vendor access</h1>
              <p>Organization session is active.</p>
              <button type="button">Sign in</button>
              <button type="button">Sign out</button>
              <button type="button">Create request</button>
            </section>
          </main>
        );
      }
    `);

    const hiddenAuth = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(hiddenAuth.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_WORKOS_AUTH_FLOW_MISSING");

    write(root, "web/app/page.tsx", `
      export default function Page() {
        return (
          <main>
            <nav><a href="#queue">Queue</a></nav>
            <section id="queue">
              <h1>Vendor access</h1>
              <a href="/login">Continue with WorkOS</a>
              <button type="button">Sign out</button>
              <button type="button">Create request</button>
            </section>
          </main>
        );
      }
    `);

    const visibleAuth = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(visibleAuth.diagnostics.map((diag) => diag.code)).not.toContain("FORGE_UI_WORKOS_AUTH_FLOW_MISSING");
  });

  test("ui audit does not treat supported auth modes as active production auth", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/agentContract.json", JSON.stringify({
      schemaVersion: "0.1.0",
      auth: { modes: ["dev-headers", "jwt", "oidc", "disabled"] },
    }));
    write(root, "src/forge/_generated/authConfig.json", JSON.stringify({
      schemaVersion: "0.1.0",
      defaultMode: "dev-headers",
      modes: ["dev-headers", "jwt", "oidc", "disabled"],
    }));
    write(root, "web/app/page.tsx", `
      export default function Page() {
        return <main><section><button type="button">Create ticket</button></section></main>;
      }
    `);

    const result = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const codes = result.diagnostics.map((diag) => diag.code);

    expect(result.ok).toBe(true);
    expect(codes).not.toContain("FORGE_UI_AUTH_FLOW_MISSING");
  });

  test("ui audit warns about demo auth copy and fake password login", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/dataGraph.json", JSON.stringify({
      schemaVersion: "0.1.0",
      generatorVersion: "0.0.0",
      analyzerVersion: "test",
      inputHash: "hash",
      tables: [{
        table: "projects",
        fields: [{ name: "id", type: "text" }, { name: "tenantId", type: "text" }],
      }],
      diagnostics: [],
    }));
    write(root, "web/app/page.tsx", `
      export default function Page() {
        return (
          <main>
            <h1>Sign in</h1>
            <p>Demo login for tenants</p>
            <form>
              <label>Email <input name="email" /></label>
              <label>Password <input name="password" type="password" placeholder="forge-demo" /></label>
              <button type="button">Sign in</button>
            </form>
          </main>
        );
      }
    `);

    const result = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const codes = result.diagnostics.map((diag) => diag.code);

    expect(result.ok).toBe(true);
    expect(codes).toContain("FORGE_UI_AUTH_COPY_TOO_DEMO");
    expect(codes).toContain("FORGE_UI_FAKE_AUTH_FORM");
  });

  test("ui audit keeps operational diagnostics out of the primary product surface", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "web/app/page.tsx", `
      export default function Page() {
        const claims = { organization_id: "org_acme", permissions: ["vendors:read"] };
        return (
          <main>
            <nav><a href="#requests">Requests</a></nav>
            <section id="requests">
              <h1>Vendor access</h1>
              <button type="button">Request access</button>
              <pre>{JSON.stringify(claims)}</pre>
              <p>WORKOS_API_KEY and workos-seed.yml are required before testing policy proof.</p>
            </section>
          </main>
        );
      }
    `);

    const exposed = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(exposed.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_DEV_DIAGNOSTICS_EXPOSED");

    write(root, "web/app/page.tsx", `
      export default function Page() {
        const claims = { organization_id: "org_acme", permissions: ["vendors:read"] };
        return (
          <main>
            <nav><a href="#requests">Requests</a></nav>
            <section id="requests">
              <h1>Vendor access</h1>
              <button type="button">Request access</button>
            </section>
            <details>
              <summary>Developer diagnostics</summary>
              <pre>{JSON.stringify(claims)}</pre>
              <p>WORKOS_API_KEY and workos-seed.yml are required before testing policy proof.</p>
            </details>
          </main>
        );
      }
    `);

    const collapsed = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(collapsed.diagnostics.map((diag) => diag.code)).not.toContain("FORGE_UI_DEV_DIAGNOSTICS_EXPOSED");
  });

  test("ui audit requires visible seed recovery instead of seed command names", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/uiTestManifest.json", JSON.stringify({
      schemaVersion: "0.1.0",
      generatorVersion: "0.0.0",
      framework: "next",
      webRoot: "web",
      defaultBaseUrl: "http://127.0.0.1:3000",
      runtimeUrl: "http://127.0.0.1:3765",
      selectors: ["[data-forge-testid='vendor-list']"],
      routes: [{
        path: "/",
        name: "home",
        uses: {
          commands: ["seedVendorAccessDemo"],
          queries: [],
          liveQueries: ["liveVendors"],
          components: ["Page"],
        },
      }],
      scenarios: ["home-loads"],
    }));
    write(root, "src/forge/_generated/uiScenarios.json", JSON.stringify({
      schemaVersion: "0.1.0",
      scenarios: [{
        name: "home-loads",
        description: "home loads",
        route: "/",
        cost: "browser",
        steps: [{ kind: "goto", path: "/" }],
        requires: {
          commands: ["seedVendorAccessDemo"],
          queries: [],
          liveQueries: ["liveVendors"],
          policies: [],
          components: ["Page"],
          workflows: [],
        },
      }],
    }));
    write(root, "web/app/page.tsx", `
      import { useCommand, useLiveQuery } from "../src/lib/forge";

      export default function Page() {
        const seedVendorAccessDemo = useCommand("seedVendorAccessDemo");
        const vendors = useLiveQuery("liveVendors", {});
        return (
          <main>
            <nav><a href="#vendors">Vendors</a></nav>
            <section id="vendors" data-forge-testid="vendor-list">
              <h1>Vendor access</h1>
              <button type="button">Create request</button>
              <p>{vendors.error ? "Error loading vendors" : vendors.loading ? "Loading vendors..." : "No vendors yet"}</p>
              <p>{String(seedVendorAccessDemo.loading)}</p>
            </section>
          </main>
        );
      }
    `);

    const missingSeedExperience = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(missingSeedExperience.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_SEED_ACTION_MISSING");
    expect(missingSeedExperience.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_AUTO_SEED_RECOVERY_MISSING");

    write(root, "web/app/page.tsx", `
      import { useCommand, useLiveQuery } from "../src/lib/forge";

      export default function Page() {
        const seedVendorAccessDemo = useCommand("seedVendorAccessDemo");
        const vendors = useLiveQuery("liveVendors", {});
        return (
          <main>
            <nav><a href="#vendors">Vendors</a></nav>
            <section id="vendors" data-forge-testid="vendor-list">
              <h1>Vendor access</h1>
              <button data-forge-testid="seed-status" type="button">Load tenant data</button>
              <button type="button">Create request</button>
              <p>{vendors.error ? "Error loading vendors" : vendors.loading ? "Loading vendors..." : "No vendors yet"}</p>
              <p>{seedVendorAccessDemo.loading ? "Preparing tenant data" : "Tenant data ready"}</p>
            </section>
          </main>
        );
      }
    `);

    const visibleSeedExperience = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(visibleSeedExperience.diagnostics.map((diag) => diag.code)).not.toContain("FORGE_UI_SEED_ACTION_MISSING");
    expect(visibleSeedExperience.diagnostics.map((diag) => diag.code)).toContain("FORGE_UI_AUTO_SEED_RECOVERY_MISSING");

    write(root, "web/app/page.tsx", `
      import { useEffect } from "react";
      import { useCommand, useLiveQuery } from "../src/lib/forge";

      export default function Page() {
        const seedVendorAccessDemo = useCommand("seedVendorAccessDemo");
        const vendors = useLiveQuery("liveVendors", {});
        useEffect(() => {
          if (!vendors.loading && !vendors.error && vendors.data?.length === 0) {
            void seedVendorAccessDemo.run({});
          }
        }, [vendors.loading, vendors.error, vendors.data?.length]);
        return (
          <main>
            <nav><a href="#vendors">Vendors</a></nav>
            <section id="vendors" data-forge-testid="vendor-list">
              <h1>Vendor access</h1>
              <button data-forge-testid="seed-status" type="button">Load tenant data</button>
              <button type="button">Create request</button>
              <p>{vendors.error ? "Error loading vendors" : vendors.loading ? "Loading vendors..." : "No vendors yet"}</p>
              <p>{seedVendorAccessDemo.loading ? "Preparing tenant data" : "Tenant data ready"}</p>
            </section>
          </main>
        );
      }
    `);

    const autoSeedExperience = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    expect(autoSeedExperience.diagnostics.map((diag) => diag.code)).not.toContain("FORGE_UI_SEED_ACTION_MISSING");
    expect(autoSeedExperience.diagnostics.map((diag) => diag.code)).not.toContain("FORGE_UI_AUTO_SEED_RECOVERY_MISSING");
  });

  test("ui audit reports auth flow warning for explicit production auth mode", async () => {
    const root = workspace();
    writeGenerated(root);
    write(root, "src/forge/_generated/authConfig.json", JSON.stringify({
      schemaVersion: "0.1.0",
      defaultMode: "oidc",
      modes: ["dev-headers", "jwt", "oidc", "disabled"],
    }));
    write(root, "web/app/page.tsx", `
      export default function Page() {
        return <main><section><button type="button">Create ticket</button></section></main>;
      }
    `);

    const result = await runUiCommand({
      ...options(root),
      subcommand: "audit",
    });
    const codes = result.diagnostics.map((diag) => diag.code);

    expect(result.ok).toBe(true);
    expect(codes).toContain("FORGE_UI_AUTH_FLOW_MISSING");
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
