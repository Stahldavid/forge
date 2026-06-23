import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAgentAdapterManifest,
  formatAgentHuman,
  runAgentCheck,
  runAgentDoctor,
  runAgentExport,
  runAgentHooksSmoke,
  runAgentHooksStatus,
  runAgentListTargets,
  runAgentOnboard,
  runAgentPrepare,
  runAgentPrintContext,
} from "../../src/forge/agent-adapters/index.ts";
import { configuredAgentTargets } from "../../src/forge/cli/verify.ts";
import type { AgentCommandOptions } from "../../src/forge/agent-adapters/types.ts";
import type { AgentContract } from "../../src/forge/compiler/agent-contract/types.ts";
import { ingestEnvelope, runAgentMemoryCommand } from "../../src/forge/agent-memory/bridge.ts";
import { normalizeAgentEvent } from "../../src/forge/agent-memory/normalize.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

const roots: string[] = [];

function contract(): AgentContract {
  return {
    schemaVersion: "0.1.0",
    generatorVersion: "test",
    project: { name: "support-app", type: "forgeos-app", template: "b2b-support-web" },
    commands: [
      {
        name: "createTicket",
        file: "src/commands/createTicket.ts",
        policy: "tickets.create",
        tablesRead: [],
        tablesWritten: ["tickets"],
        emits: ["ticket.created"],
        allowedPackages: ["zod"],
        forbiddenCapabilities: ["network", "secrets", "ai"],
        http: { method: "POST", path: "/commands/createTicket", exampleBody: { args: {} } },
        frontend: { hook: "useCommand(api.commands.createTicket)", routes: ["/tickets"], components: [] },
      },
    ],
    queries: [
      {
        name: "listTickets",
        file: "src/queries/listTickets.ts",
        policy: "tickets.read",
        allowedPackages: [],
        forbiddenCapabilities: ["network"],
        readOnly: true,
        tenantScoped: true,
        tablesRead: ["tickets"],
        http: { method: "POST", path: "/queries/listTickets", exampleBody: { args: {} } },
        frontend: { hook: "useQuery(api.queries.listTickets, args)", routes: ["/tickets"], components: [] },
      },
    ],
    liveQueries: [
      {
        name: "liveTickets",
        file: "src/queries/liveTickets.ts",
        policy: "tickets.read",
        allowedPackages: [],
        forbiddenCapabilities: ["network"],
        tablesRead: ["tickets"],
        dependencies: [{ table: "tickets", scope: "tenant" }],
        http: { method: "GET", path: "/live/liveTickets", exampleUrl: "/live/liveTickets?args={}" },
        frontend: { hook: "useLiveQuery(api.liveQueries.liveTickets, args)", routes: ["/tickets"], components: [] },
      },
    ],
    actions: [
      {
        name: "captureTicketCreated",
        file: "src/actions/captureTicketCreated.ts",
        event: "ticket.created",
        policy: "system",
        allowedPackages: ["resend"],
        forbiddenCapabilities: [],
        allowedCapabilities: ["network", "secrets"],
        http: { method: "POST", path: "/actions/captureTicketCreated", exampleBody: { args: {} } },
        frontend: { hook: "no generated React hook; invoke from server/action code", routes: [], components: [] },
      },
    ],
    workflows: [
      {
        name: "triageTicketWorkflow",
        file: "src/workflows/triageTicketWorkflow.ts",
        trigger: "ticket.created",
        steps: ["loadTicket", "triage", "save"],
      },
    ],
    data: {
      tables: [
        {
          name: "tickets",
          file: "src/forge/schema.ts",
          tenantScoped: true,
          tenantField: "tenantId",
          fields: ["id", "tenantId", "title", "status"],
        },
      ],
    },
    policies: [
      {
        name: "tickets.read",
        kind: "roles",
        roles: ["owner", "admin", "member"],
        file: "src/policies/tickets.ts",
      },
      {
        name: "tickets.create",
        kind: "roles",
        roles: ["owner", "admin"],
        file: "src/policies/tickets.ts",
      },
    ],
    packages: [
      {
        name: "zod",
        version: "3.0.0",
        allowedContexts: ["command", "query", "liveQuery", "action", "workflow", "client"],
        deniedContexts: [],
      },
    ],
    dependencyApis: [],
    integrations: [],
    secrets: [
      {
        name: "OPENAI_API_KEY",
        required: true,
        allowedContexts: ["action", "workflow", "server"],
      },
    ],
    telemetry: { events: ["ticket.created"], sinks: ["local"] },
    ai: { providers: ["openai"], generations: [], tools: [], agents: [] },
    client: {
      queries: ["listTickets"],
      commands: ["createTicket"],
      liveQueries: ["liveTickets"],
      reactHooks: ["useQuery", "useLiveQuery", "useCommand"],
      transport: { mode: "fetch" },
    },
    frontend: {
      present: true,
      framework: "next",
      root: "web",
      dev: {
        command: "cd web && bun run dev",
        url: "http://127.0.0.1:3000",
        apiUrlEnv: "NEXT_PUBLIC_FORGE_URL",
        defaultApiUrl: "http://127.0.0.1:3765",
      },
      routes: [
        {
          path: "/tickets",
          file: "web/app/tickets/page.tsx",
          components: [],
          usesCommands: ["createTicket"],
          usesQueries: ["listTickets"],
          usesLiveQueries: ["liveTickets"],
          rawForgeFetches: [],
        },
      ],
      components: [],
      providers: [
        {
          name: "ForgeProvider",
          file: "web/app/providers.tsx",
          apiUrlEnv: "NEXT_PUBLIC_FORGE_URL",
          devAuth: true,
        },
      ],
      bridgeFiles: ["web/lib/forge.ts"],
      webManifest: {
        present: true,
        framework: "next",
        root: "web",
        packageManager: "bun",
        scripts: {
          dev: "next dev",
        },
        urls: {
          dev: "http://127.0.0.1:3000",
          api: "http://127.0.0.1:3765",
        },
        env: {
          apiUrl: "NEXT_PUBLIC_FORGE_URL",
        },
        bridge: {
          files: ["web/lib/forge.ts"],
          valid: true,
        },
      },
      clientBindings: [
        {
          kind: "command",
          name: "createTicket",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
        },
        {
          kind: "query",
          name: "listTickets",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
        },
        {
          kind: "liveQuery",
          name: "liveTickets",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
        },
      ],
      runtimeEndpoints: [
        {
          kind: "command",
          name: "createTicket",
          http: { method: "POST", path: "/commands/createTicket", exampleBody: { args: {} } },
          frontend: { hook: "useCommand(api.commands.createTicket)", routes: ["/tickets"], components: [] },
        },
        {
          kind: "query",
          name: "listTickets",
          http: { method: "POST", path: "/queries/listTickets", exampleBody: { args: {} } },
          frontend: { hook: "useQuery(api.queries.listTickets, args)", routes: ["/tickets"], components: [] },
        },
        {
          kind: "liveQuery",
          name: "liveTickets",
          http: { method: "GET", path: "/live/liveTickets", exampleUrl: "/live/liveTickets?args={}" },
          frontend: { hook: "useLiveQuery(api.liveQueries.liveTickets, args)", routes: ["/tickets"], components: [] },
        },
      ],
      routeBindings: [
        {
          kind: "command",
          name: "createTicket",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
          hook: "useCommand(api.commands.createTicket)",
          http: { method: "POST", path: "/commands/createTicket", exampleBody: { args: {} } },
          policy: "tickets.create",
          tablesRead: [],
          tablesWritten: ["tickets"],
          emits: ["ticket.created"],
          dependencies: [],
        },
        {
          kind: "query",
          name: "listTickets",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
          hook: "useQuery(api.queries.listTickets, args)",
          http: { method: "POST", path: "/queries/listTickets", exampleBody: { args: {} } },
          policy: "tickets.read",
          tablesRead: ["tickets"],
          tablesWritten: [],
          emits: [],
          dependencies: [],
        },
        {
          kind: "liveQuery",
          name: "liveTickets",
          file: "web/app/tickets/page.tsx",
          route: "/tickets",
          hook: "useLiveQuery(api.liveQueries.liveTickets, args)",
          http: { method: "GET", path: "/live/liveTickets", exampleUrl: "/live/liveTickets?args={}" },
          policy: "tickets.read",
          tablesRead: ["tickets"],
          tablesWritten: [],
          emits: [],
          dependencies: [{ table: "tickets", scope: "tenant" }],
        },
      ],
      componentBindings: [],
      diagnostics: [],
    },
    auth: {
      modes: ["dev-headers", "jwt", "oidc", "disabled"],
      defaultMode: "dev-headers",
      productionDefaultAllowed: false,
      bearerTokenHeader: "Authorization",
      env: {
        mode: "FORGE_AUTH_MODE",
        issuer: "FORGE_AUTH_ISSUER",
        audience: "FORGE_AUTH_AUDIENCE",
        jwksUri: "FORGE_AUTH_JWKS_URI",
        algorithms: "FORGE_AUTH_ALGORITHMS",
      },
      claims: { userId: "sub", tenantId: "tenant_id", role: "role" },
      requiresTenant: true,
    },
    deploy: { selfHost: true, files: ["deploy/docker-compose.yml"] },
    rules: [],
    playbooks: [],
    agentProtocols: [],
    commandsToRun: {
      beforeEditing: ["forge status --json", "forge agent print-context --json"],
      afterEditing: ["forge generate", "forge check", "forge verify --strict"],
      dev: ["forge dev"],
    },
  };
}

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), "forge-h30-"));
  roots.push(root);
  mkdirSync(join(root, "src/forge/_generated"), { recursive: true });
  writeFileSync(
    join(root, "src/forge/_generated/agentContract.json"),
    `${JSON.stringify(contract(), null, 2)}\n`,
  );
  writeFileSync(
    join(root, "AGENTS.md"),
    "# AGENTS.md\n\n<!-- forge-generated:start -->\nold\n<!-- forge-generated:end -->\n\n<!-- user-notes:start -->\nkeep me\n<!-- user-notes:end -->\n",
  );
  return root;
}

function options(root: string, target = "generic"): AgentCommandOptions {
  return {
    subcommand: "export",
    workspaceRoot: root,
    json: true,
    target,
    dryRun: false,
    force: false,
    preserveUserSections: true,
    skills: true,
    rules: true,
  };
}

async function recordNativeCodexSignal(root: string) {
  const result = await runAgentMemoryCommand({
    subcommand: "ingest",
    workspaceRoot: root,
    json: true,
    target: "codex",
    source: "codex",
    eventName: "PostToolUse",
    input: {
      session_id: "codex-native-session",
      tool_name: "Edit",
      cwd: root,
      status: "completed",
      tool_input: { file_path: "AGENTS.md" },
      tool_response: { status: "success" },
    },
  });
  expect(result.exitCode).toBe(0);
  return result;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("H30 agent adapter export", () => {
  test("generic export writes agent context artifacts without owning generated AGENTS.md", () => {
    const root = workspace();
    const result = runAgentExport(options(root, "generic"));
    expect(result.ok).toBe(true);
    expect(result.filesPlanned).not.toContain("AGENTS.md");
    expect(existsSync(join(root, ".forge/agent/context.json"))).toBe(true);
    expect(existsSync(join(root, ".forge/agent/commands.json"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("old");
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("keep me");
    const context = JSON.parse(readFileSync(join(root, ".forge/agent/context.json"), "utf8"));
    expect(context.commands).toContain("createTicket");
    expect(context.secrets).toContain("OPENAI_API_KEY");
  });

  test("codex, cursor, and claude exports write target files", () => {
    const root = workspace();
    expect(runAgentExport(options(root, "codex")).ok).toBe(true);
    expect(existsSync(join(root, ".codex/skills/forge-add-command/SKILL.md"))).toBe(true);
    const explorerRole = readFileSync(join(root, ".codex/agents/forge-explorer.toml"), "utf8");
    expect(explorerRole).toContain('name = "forge-explorer"');
    expect(explorerRole).toContain("developer_instructions");
    expect(explorerRole).toContain("forge inspect all --brief --json");
    expect(runAgentExport(options(root, "cursor")).ok).toBe(true);
    expect(existsSync(join(root, ".cursor/rules/forge-runtime.mdc"))).toBe(true);
    expect(runAgentExport(options(root, "claude")).ok).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
    expect(readFileSync(join(root, "CLAUDE.md"), "utf8")).toContain("forge handoff --json");
  });

  test("dry-run writes nothing and reports planned files", () => {
    const root = workspace();
    const result = runAgentExport({ ...options(root, "codex"), dryRun: true });
    expect(result.ok).toBe(true);
    expect(result.filesWritten).toEqual([]);
    expect(result.filesPlanned).toContain(".codex/skills/forge-add-command/SKILL.md");
    expect(existsSync(join(root, ".codex"))).toBe(false);
  });

  test("agent check detects stale exports", () => {
    const root = workspace();
    expect(runAgentExport(options(root, "generic")).ok).toBe(true);
    writeFileSync(join(root, ".forge/agent/context.json"), "{}\n");
    const check = runAgentCheck({ ...options(root, "generic"), subcommand: "check" });
    expect(check.ok).toBe(false);
    expect(check.stale).toContain(".forge/agent/context.json");
  });

  test("custom adapter renders templates with project context", () => {
    const root = workspace();
    mkdirSync(join(root, ".forge/agent-adapters/my-agent/templates"), { recursive: true });
    writeFileSync(
      join(root, ".forge/agent-adapters/my-agent/adapter.json"),
      JSON.stringify({
        name: "my-agent",
        outputs: [{ template: "instructions.md.hbs", path: "MY_AGENT.md" }],
      }),
    );
    writeFileSync(
      join(root, ".forge/agent-adapters/my-agent/templates/instructions.md.hbs"),
      "# {{project.name}}\n\nCommands: {{json context.commands}}\n",
    );
    const result = runAgentExport(options(root, "my-agent"));
    expect(result.ok).toBe(true);
    expect(readFileSync(join(root, "MY_AGENT.md"), "utf8")).toContain("support-app");
    expect(readFileSync(join(root, "MY_AGENT.md"), "utf8")).toContain("createTicket");
  });

  test("secret scrubber blocks leaked adapter output", () => {
    const root = workspace();
    mkdirSync(join(root, ".forge/agent-adapters/leaky/templates"), { recursive: true });
    writeFileSync(
      join(root, ".forge/agent-adapters/leaky/adapter.json"),
      JSON.stringify({
        name: "leaky",
        outputs: [{ template: "instructions.md.hbs", path: "LEAK.md" }],
      }),
    );
    writeFileSync(
      join(root, ".forge/agent-adapters/leaky/templates/instructions.md.hbs"),
      "do not write sk_test_12345\n",
    );
    const result = runAgentExport(options(root, "leaky"));
    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diag) => diag.code)).toContain("FORGE_AGENT_SECRET_LEAK");
  });

  test("manifest, print-context, target list, and repeated exports are deterministic", () => {
    const root = workspace();
    const manifest = buildAgentAdapterManifest(contract());
    expect(manifest.targets.map((target) => target.name)).toEqual(["generic", "codex", "cursor", "claude"]);
    expect(runAgentListTargets(root).targets.map((target) => target.name)).toContain("generic");
    const context = runAgentPrintContext(root);
    expect(context.context?.project.name).toBe("support-app");
    const first = runAgentExport(options(root, "generic"));
    const second = runAgentExport(options(root, "generic"));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.filesWritten).toEqual([]);
  });

  test("verify integration detects configured adapter targets", () => {
    const root = workspace();
    expect(configuredAgentTargets(root)).toEqual([]);
    expect(runAgentExport(options(root, "all")).ok).toBe(true);
    expect(configuredAgentTargets(root)).toEqual(["generic", "codex", "cursor", "claude"]);
  });

  test("agent prepare exports context, installs hooks, and returns next commands", async () => {
    const root = workspace();
    const result = await runAgentPrepare({ ...options(root, "codex"), subcommand: "prepare" });
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, ".codex/skills/forge-add-command/SKILL.md"))).toBe(true);
    expect(JSON.stringify(result.commands)).toContain("forge agent hooks status --target codex --json");
    expect(JSON.stringify(result.commands)).toContain("forge agent hooks smoke --target codex --json");
  });

  test("agent onboard prepares adapters and stops at the Codex hook approval boundary", async () => {
    const root = scaffoldGenerateWorkspace("agent-onboard-codex");
    try {
      const result = await runAgentOnboard({ ...options(root, "codex"), subcommand: "onboard" });
      expect(result.ok).toBe(false);
      expect(result.readyToEdit).toBe(false);
      expect(result.summary).toMatchObject({
        adapter: "ready",
        hookBridge: "waiting-for-user-trust",
        approvalRequired: true,
        approvalStatus: "waiting-for-user-trust",
        safeToEdit: true,
      });
      expect(typeof result.summary.generatedFresh).toBe("boolean");
      expect(result.summary.memorySignals).toBeGreaterThan(0);
      expect(result.summary.canarySignals).toBeGreaterThan(0);
      expect(result.summary.nativeSignals).toBe(0);
      expect(result.steps.map((step) => step.name)).toContain("hook-smoke");
      expect(result.steps.map((step) => step.name)).toContain("hook-approval");
      expect(result.commands.changed).toBe("forge changed --json");
      expect(result.commands.dev).toBe("forge dev --once --json");
      expect(result.commands.context).toBe("forge agent context --current --json");
      expect(result.nextActions).toContain(
        "Continue or send one Codex message in this workspace so a normal native hook event is emitted",
      );
      expect(result.nextActions).toContain("If Codex Desktop shows a hook approval prompt, approve it");
      expect(result.recommendedReadFiles).toContain("AGENTS.md");
    } finally {
      cleanupWorkspace(root);
    }
  }, 45_000);

  test("agent hooks status explains installation, memory visibility, and useful signals", async () => {
    const root = workspace();
    const missing = await runAgentHooksStatus({ ...options(root, "codex"), subcommand: "hooks", hookAction: "status" });
    expect(missing.ok).toBe(false);
    expect(missing.installed).toBe(false);
    expect(missing.visibleInMemory).toBe(false);
    expect(missing.nextActions).toContain("forge agent install codex --json");

    const prepared = await runAgentPrepare({ ...options(root, "codex"), subcommand: "prepare" });
    expect(prepared.ok).toBe(true);
    const waiting = await runAgentHooksStatus({ ...options(root, "codex"), subcommand: "hooks", hookAction: "status" });
    expect(waiting.installed).toBe(true);
    expect(waiting.approvalRequired).toBe(true);
    expect(waiting.approvalStatus).toBe("waiting-for-user-trust");
    expect(waiting.visibleInMemory).toBe(false);
    expect(waiting.nextActions).toContain("Approve the installed hooks in Codex Desktop (Confiar em tudo or Revisar hooks)");
    expect(waiting.nextActions).toContain("forge agent hooks smoke --target codex --json");

    const smoke = await runAgentHooksSmoke({ ...options(root, "codex"), subcommand: "hooks", hookAction: "smoke" });
    expect(smoke.ok).toBe(true);
    expect(smoke.exitCode).toBe(0);
    expect(smoke.smokeReady).toBe(true);
    expect(smoke.trustedNativeReady).toBe(false);
    expect(smoke.readinessLevel).toBe("canary");
    expect(smoke.approvalRequired).toBe(true);
    expect(smoke.canary?.visible).toBe(true);
    const stillWaiting = await runAgentHooksStatus({ ...options(root, "codex"), subcommand: "hooks", hookAction: "status" });
    expect(stillWaiting.ok).toBe(false);
    expect(stillWaiting.visibleInMemory).toBe(true);
    expect(stillWaiting.usefulSignals).toBeGreaterThan(0);
    expect(stillWaiting.nativeSignals).toBe(0);
    expect(stillWaiting.canarySignals).toBeGreaterThan(0);
    expect(stillWaiting.nextActions).toContain(
      "Continue or send one Codex message in this workspace so a normal native hook event is emitted",
    );
    expect(stillWaiting.nextActions).not.toContain("Approve the installed hooks in Codex Desktop (Confiar em tudo or Revisar hooks)");
    expect(stillWaiting.checks.find((check) => check.name === "codex-hook-approval")?.message).toContain("smoke canary");

    await recordNativeCodexSignal(root);
    const ready = await runAgentHooksStatus({ ...options(root, "codex"), subcommand: "hooks", hookAction: "status" });
    expect(ready.ok).toBe(true);
    expect(ready.installed).toBe(true);
    expect(ready.bridgeWritable).toBe(true);
    expect(ready.deltaWritable).toBe(true);
    expect(ready.visibleInMemory).toBe(true);
    expect(ready.usefulSignals).toBeGreaterThan(0);
    expect(ready.nativeSignals).toBeGreaterThan(0);
    expect(ready.approvalRequired).toBe(false);
    expect(ready.approvalStatus).toBe("trusted");
  }, 45_000);

  test("agent hooks status ignores native Codex signals from other workspaces", async () => {
    const root = workspace();
    const otherRoot = workspace();
    const prepared = await runAgentPrepare({ ...options(root, "codex"), subcommand: "prepare" });
    expect(prepared.ok).toBe(true);

    const foreignEnvelope = normalizeAgentEvent({
      workspaceRoot: otherRoot,
      source: "codex",
      eventName: "PostToolUse",
      raw: {
        session_id: "codex-native-foreign-session",
        tool_name: "Edit",
        cwd: otherRoot,
        status: "completed",
        tool_input: { file_path: "AGENTS.md" },
        tool_response: { status: "success" },
      },
    });
    const ingested = await ingestEnvelope(root, foreignEnvelope);
    expect(ingested.ok).toBe(true);

    const status = await runAgentHooksStatus({ ...options(root, "codex"), subcommand: "hooks", hookAction: "status" });
    expect(status.ok).toBe(false);
    expect(status.installed).toBe(true);
    expect(status.visibleInMemory).toBe(false);
    expect(status.usefulSignals).toBe(0);
    expect(status.nativeSignals).toBe(0);
    expect(status.approvalStatus).toBe("waiting-for-user-trust");
    expect(status.checks.find((check) => check.name === "workspace-scope")?.ok).toBe(true);
    expect(status.nextActions).toContain("forge agent hooks smoke --target codex --json");
  }, 45_000);

  test("agent hooks smoke stores a canary hook event without bypassing Codex trust", async () => {
    const root = workspace();
    const result = await runAgentHooksSmoke({ ...options(root, "codex"), subcommand: "hooks", hookAction: "smoke" });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.smokeReady).toBe(true);
    expect(result.trustedNativeReady).toBe(false);
    expect(result.readinessLevel).toBe("canary");
    expect(result.installed).toBe(true);
    expect(result.bridgeWritable).toBe(true);
    expect(result.deltaWritable).toBe(true);
    expect(result.visibleInMemory).toBe(true);
    expect(result.usefulSignals).toBeGreaterThan(0);
    expect(result.nativeSignals).toBe(0);
    expect(result.canarySignals).toBeGreaterThan(0);
    expect(result.approvalRequired).toBe(true);
    expect(result.approvalStatus).toBe("waiting-for-user-trust");
    expect(result.lastSignal?.summary).toContain("forge agent hooks smoke");
    expect(result.canary).toMatchObject({
      marker: "FORGE_HOOK_SMOKE_CANARY",
      source: "codex",
      eventName: "SessionStart",
      visible: true,
    });
    expect(result.canary?.ingestedEventId).toBeTruthy();
    expect(result.canary?.memoryEventsChecked).toBeGreaterThan(0);
    expect(result.checks).toContainEqual({
      name: "canary-ingest",
      ok: true,
      message: "canary event was normalized and stored",
    });
    expect(result.nextActions).toContain(
      "Continue or send one Codex message in this workspace so a normal native hook event is emitted",
    );
    expect(result.checks.some((check) => check.name === "canary-memory-readable" && check.ok)).toBe(true);
    expect(result.checks.some((check) => check.name === "codex-hook-approval" && check.ok)).toBe(true);
    expect(result.diagnostics.some((diag) => diag.code === "FORGE_AGENT_HOOK_APPROVAL_REQUIRED")).toBe(true);
    expect(JSON.stringify(result.ingestResult)).toContain("FORGE_HOOK_SMOKE_CANARY");
    const human = formatAgentHuman(result);
    expect(human).toContain("smoke ready: yes");
    expect(human).toContain("trusted native ready: no");
    expect(human).toContain("readiness level: canary");
    expect(human).toContain("approval: waiting-for-user-trust");
    expect(human).toContain("Canary:");
    expect(human).toContain("marker: FORGE_HOOK_SMOKE_CANARY");
    expect(human).toContain("ingested id:");
    expect(human).toContain("memory events checked:");
    expect(human).toContain("visible: yes");
    expect(human).toContain("last signal:");
    expect(human).toContain("forge agent hooks status --target codex --json");
  }, 45_000);

  test(
    "agent doctor explains adapter, hook bridge, memory, and next actions",
    async () => {
      const root = workspace();
      const missing = await runAgentDoctor({ ...options(root, "codex"), subcommand: "doctor" });
      expect(missing.ok).toBe(false);
      expect(missing.summary).toMatchObject({
        adapter: "missing",
        hookBridge: "missing",
        recentEvents: 0,
      });
      expect(missing.nextActions).toContain("forge agent export --target codex");
      expect(missing.nextActions).toContain("forge agent install codex --json");
      expect(missing.nextActions).toContain("forge agent hooks smoke --target codex --json");

      const prepared = await runAgentPrepare({ ...options(root, "codex"), subcommand: "prepare" });
      expect(prepared.ok).toBe(true);
      const smoke = await runAgentHooksSmoke({ ...options(root, "codex"), subcommand: "hooks", hookAction: "smoke" });
      expect(smoke.ok).toBe(true);
      expect(smoke.exitCode).toBe(0);
      expect(smoke.smokeReady).toBe(true);
      expect(smoke.trustedNativeReady).toBe(false);
      expect(smoke.readinessLevel).toBe("canary");

      const needsApproval = await runAgentDoctor({ ...options(root, "codex"), subcommand: "doctor" });
      expect(needsApproval.ok).toBe(false);
      expect(needsApproval.summary).toMatchObject({
        adapter: "ready",
        hookBridge: "waiting-for-user-trust",
        approvalRequired: true,
        approvalStatus: "waiting-for-user-trust",
        recentEvents: 1,
        usefulSignals: 1,
        nativeSignals: 0,
        canarySignals: 1,
      });
      expect(needsApproval.nextActions).toContain(
        "Continue or send one Codex message in this workspace so a normal native hook event is emitted",
      );
      expect(needsApproval.nextActions).toContain("If Codex Desktop shows a hook approval prompt, approve it");

      await recordNativeCodexSignal(root);

      const ready = await runAgentDoctor({ ...options(root, "codex"), subcommand: "doctor" });
      expect(ready.ok).toBe(true);
      expect(ready.summary).toMatchObject({
        adapter: "ready",
        hookBridge: "ready",
        approvalRequired: false,
        approvalStatus: "trusted",
        recentEvents: 2,
        usefulSignals: 2,
        nativeSignals: 1,
        canarySignals: 1,
      });
      expect(ready.nextActions).toContain("forge agent context --current --json");
      expect(ready.nextActions).toContain("forge agent memory --entry codex --json");
    },
    45_000,
  );
});
