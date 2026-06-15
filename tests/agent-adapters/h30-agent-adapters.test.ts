import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAgentAdapterManifest,
  runAgentCheck,
  runAgentExport,
  runAgentListTargets,
  runAgentPrintContext,
} from "../../src/forge/agent-adapters/index.ts";
import { configuredAgentTargets } from "../../src/forge/cli/verify.ts";
import type { AgentCommandOptions } from "../../src/forge/agent-adapters/types.ts";
import type { AgentContract } from "../../src/forge/compiler/agent-contract/types.ts";

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
    ai: { providers: ["openai"], generations: [] },
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
    commandsToRun: {
      beforeEditing: ["forge inspect all --json"],
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

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("H30 agent adapter export", () => {
  test("generic export writes AGENTS.md and agent context artifacts", () => {
    const root = workspace();
    const result = runAgentExport(options(root, "generic"));
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, ".forge/agent/context.json"))).toBe(true);
    expect(existsSync(join(root, ".forge/agent/commands.json"))).toBe(true);
    expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("keep me");
    const context = JSON.parse(readFileSync(join(root, ".forge/agent/context.json"), "utf8"));
    expect(context.commands).toContain("createTicket");
    expect(context.secrets).toContain("OPENAI_API_KEY");
  });

  test("codex, cursor, and claude exports write target files", () => {
    const root = workspace();
    expect(runAgentExport(options(root, "codex")).ok).toBe(true);
    expect(existsSync(join(root, ".codex/skills/forge-add-command/SKILL.md"))).toBe(true);
    expect(runAgentExport(options(root, "cursor")).ok).toBe(true);
    expect(existsSync(join(root, ".cursor/rules/forge-runtime.mdc"))).toBe(true);
    expect(runAgentExport(options(root, "claude")).ok).toBe(true);
    expect(existsSync(join(root, "CLAUDE.md"))).toBe(true);
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
});
