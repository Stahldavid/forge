import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../../src/forge/cli/parse.ts";
import { formatSeedHuman, runSeedCommand } from "../../src/forge/cli/seed.ts";

const workspaces: string[] = [];
const servers: Server[] = [];

function workspaceWithSeedCommand(name = "seedDemoData", devScript = "forge dev --seed") {
  const workspace = mkdtempSync(join(tmpdir(), "forge-seed-cli-"));
  workspaces.push(workspace);
  writeFileSync(
    join(workspace, "package.json"),
    JSON.stringify({
      scripts: {
        dev: devScript,
      },
    }),
    "utf8",
  );
  mkdirSync(join(workspace, "src/forge/_generated"), { recursive: true });
  writeFileSync(
    join(workspace, "src/forge/_generated/runtimeGraph.json"),
    JSON.stringify({
      schemaVersion: "0.1.0",
      entries: [
        {
          id: `command:${name}`,
          kind: "command",
          name,
          qualifiedName: name,
          file: `src/commands/${name}.ts`,
          symbolId: `S#${name}`,
          moduleId: `M#${name}`,
          runtimeContext: "command",
          dependencies: [],
        },
      ],
      diagnostics: [],
    }),
    "utf8",
  );
  return workspace;
}

async function fakeForgeRuntime() {
  let captured: {
    method?: string;
    url?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: unknown;
  } = {};
  const capturedAll: typeof captured[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      captured = {
        method: request.method,
        url: request.url,
        headers: request.headers,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"),
      };
      capturedAll.push(captured);
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ ok: true, seeded: true }));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("fake server did not bind to a TCP port");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    captured: () => captured,
    capturedAll: () => capturedAll,
  };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("forge seed", () => {
  test("parseCli accepts seed status, dev, and reset", () => {
    expect(parseCli(["seed", "status", "--json"]).command).toMatchObject({
      kind: "seed",
      subcommand: "status",
      json: true,
    });
    expect(parseCli(["seed", "dev", "--command", "seedDemoData", "--permissions", "demo:seed,vendors:read"]).command).toMatchObject({
      kind: "seed",
      subcommand: "dev",
      command: "seedDemoData",
      permissions: ["demo:seed", "vendors:read"],
    });
    expect(parseCli(["seed", "dev", "--all-tenants", "--json"]).command).toMatchObject({
      kind: "seed",
      subcommand: "dev",
      allTenants: true,
      json: true,
    });
    expect(parseCli(["seed", "reset", "--args", "{\"tenant\":\"acme\"}"]).command).toMatchObject({
      kind: "seed",
      subcommand: "reset",
      args: { tenant: "acme" },
    });
  });

  test("status discovers generated seed commands", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    const result = await runSeedCommand({
      subcommand: "status",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.selectedCommand).toBe("seedVendorAccessDemo");
    expect(result.commands[0]).toMatchObject({
      name: "seedVendorAccessDemo",
      selected: true,
    });
    expect(result.readiness).toMatchObject({
      ready: true,
      reason: "seed-command-ready",
      autoSeedOnDev: true,
      autoSeedAllTenantsOnDev: false,
      autoSeedMode: "default-tenant",
      selectedCommand: "seedVendorAccessDemo",
      defaultAuth: {
        userId: "forge-seed",
        tenantId: "11111111-1111-4111-8111-111111111111",
        role: "owner",
        permissions: ["demo:seed"],
      },
    });
    expect(result.readiness.emptyWorkspaceRecovery).toEqual([
      "npm run dev",
      "forge seed dev --command seedVendorAccessDemo --json",
      "forge seed reset --command seedVendorAccessDemo --json",
    ]);
  });

  test("status detects auto-seed dev scripts across common CLI wrappers", async () => {
    for (const devScript of [
      "forge dev --seed",
      "npm run forge -- dev --seed",
      "node bin/forge.mjs dev --seed",
      "./bin/forge.mjs dev --seed",
    ]) {
      const workspace = workspaceWithSeedCommand("seedVendorAccessDemo", devScript);
      const result = await runSeedCommand({
        subcommand: "status",
        args: {},
        json: true,
        workspaceRoot: workspace,
      });

      expect(result.readiness.autoSeedOnDev).toBe(true);
      expect(result.readiness.autoSeedAllTenantsOnDev).toBe(false);
      expect(result.readiness.autoSeedMode).toBe("default-tenant");
      expect(result.readiness.emptyWorkspaceRecovery[0]).toBe("npm run dev");
    }
  });

  test("status distinguishes dev scripts that seed all local tenants", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo", "forge dev --seed --all-tenants");
    mkdirSync(join(workspace, "web/src"), { recursive: true });
    writeFileSync(
      join(workspace, "web/src/main.tsx"),
      `
        const personas = [
          {
            label: "Acme owner",
            email: "owner@acme.example",
            organizationId: "tenant-acme",
            organizationName: "Acme Corp",
            role: "owner",
            permissions: ["demo:seed"],
          },
          {
            label: "Globex auditor",
            email: "audit@globex.example",
            organizationId: "tenant-globex",
            organizationName: "Globex Security",
            role: "auditor",
            permissions: ["demo:seed"],
          },
        ];
      `,
      "utf8",
    );

    const result = await runSeedCommand({
      subcommand: "status",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.readiness.autoSeedOnDev).toBe(true);
    expect(result.readiness.autoSeedAllTenantsOnDev).toBe(true);
    expect(result.readiness.autoSeedMode).toBe("all-tenants");
    expect(result.readiness.emptyWorkspaceRecovery[0]).toBe("npm run dev");
    expect(formatSeedHuman(result)).toContain("dev script: auto-seeds all local tenants with forge dev --seed --all-tenants");
  });

  test("status reports local tenant seed commands from frontend personas", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    mkdirSync(join(workspace, "web/src"), { recursive: true });
    writeFileSync(
      join(workspace, "web/src/main.tsx"),
      `
        const personas = [
          {
            id: "acme-owner",
            label: "Acme owner",
            email: "owner@acme.example",
            organizationId: "tenant-acme",
            organizationName: "Acme Corp",
            role: "owner",
            permissions: ["demo:seed", "vendors:read", "access:approve"],
          },
          {
            id: "globex-auditor",
            label: "Globex auditor",
            email: "audit@globex.example",
            organizationId: "tenant-globex",
            organizationName: "Globex Security",
            role: "auditor",
            permissions: ["demo:seed", "vendors:read"],
          },
        ];
      `,
      "utf8",
    );

    const result = await runSeedCommand({
      subcommand: "status",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.exitCode).toBe(0);
    expect(result.readiness.localTenants).toHaveLength(2);
    expect(result.readiness.localTenants[0]).toMatchObject({
      tenantId: "tenant-acme",
      organizationName: "Acme Corp",
      userId: "owner@acme.example",
      role: "owner",
      permissions: ["demo:seed", "vendors:read", "access:approve"],
    });
    expect(result.readiness.localTenants[0]?.seedCommand).toBe(
      "forge seed dev --command seedVendorAccessDemo --tenant-id tenant-acme --user-id owner@acme.example --role owner --permissions demo:seed,vendors:read,access:approve --json",
    );
    expect(result.readiness.localTenants[1]?.resetCommand).toBe(
      "forge seed reset --command seedVendorAccessDemo --tenant-id tenant-globex --user-id audit@globex.example --role auditor --permissions demo:seed,vendors:read --json",
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "FORGE_SEED_DEV_PARTIAL_TENANTS",
      severity: "warning",
    });
    expect(result.readiness.emptyWorkspaceRecovery[0]).toBe("forge dev --seed --all-tenants");
    expect(formatSeedHuman(result)).toContain("local tenant seed commands:");
    expect(formatSeedHuman(result)).toContain("Acme Corp: forge seed dev --command seedVendorAccessDemo");
    expect(formatSeedHuman(result)).toContain("warning FORGE_SEED_DEV_PARTIAL_TENANTS");
  });

  test("dev can seed all discovered local tenants", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    mkdirSync(join(workspace, "web/src"), { recursive: true });
    writeFileSync(
      join(workspace, "web/src/main.tsx"),
      `
        const personas = [
          {
            label: "Acme owner",
            email: "owner@acme.example",
            organizationId: "tenant-acme",
            organizationName: "Acme Corp",
            role: "owner",
            permissions: ["demo:seed", "vendors:read", "access:approve"],
          },
          {
            label: "Globex auditor",
            email: "audit@globex.example",
            organizationId: "tenant-globex",
            organizationName: "Globex Security",
            role: "auditor",
            permissions: ["demo:seed", "vendors:read"],
          },
        ];
      `,
      "utf8",
    );
    const runtime = await fakeForgeRuntime();

    const result = await runSeedCommand({
      subcommand: "dev",
      command: "seedVendorAccessDemo",
      args: { source: "all-tenants-test" },
      url: runtime.url,
      allTenants: true,
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.tenantRuns).toHaveLength(2);
    expect(result.tenantRuns?.map((run) => run.tenantId)).toEqual(["tenant-acme", "tenant-globex"]);
    expect(result.tenantRuns?.[0]?.diagnostics[0]?.code).toBe("FORGE_SEED_DEV_PARTIAL_TENANTS");
    expect(result.tenantRuns?.[1]?.diagnostics[0]?.code).toBe("FORGE_SEED_DEV_PARTIAL_TENANTS");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["FORGE_SEED_DEV_PARTIAL_TENANTS"]);
    expect(runtime.capturedAll()).toHaveLength(2);
    expect(runtime.capturedAll()[0]?.headers?.["x-forge-tenant-id"]).toBe("tenant-acme");
    expect(runtime.capturedAll()[0]?.headers?.["x-forge-permissions"]).toBe("[\"demo:seed\",\"vendors:read\",\"access:approve\"]");
    expect(runtime.capturedAll()[1]?.headers?.["x-forge-tenant-id"]).toBe("tenant-globex");
    expect(runtime.capturedAll()[1]?.headers?.["x-forge-role"]).toBe("auditor");
    expect(formatSeedHuman(result)).toContain("tenant seed runs:");
    expect(formatSeedHuman(result)).toContain("ok Acme Corp");
  });

  test("dev warns when multiple local tenants exist but only the default tenant is seeded", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo", "forge dev --seed");
    mkdirSync(join(workspace, "web/src"), { recursive: true });
    writeFileSync(
      join(workspace, "web/src/main.tsx"),
      `
        const personas = [
          {
            label: "Acme owner",
            email: "owner@acme.example",
            organizationId: "tenant-acme",
            organizationName: "Acme Corp",
            role: "owner",
            permissions: ["demo:seed"],
          },
          {
            label: "Globex auditor",
            email: "audit@globex.example",
            organizationId: "tenant-globex",
            organizationName: "Globex Security",
            role: "auditor",
            permissions: ["demo:seed"],
          },
        ];
      `,
      "utf8",
    );
    const runtime = await fakeForgeRuntime();

    const result = await runSeedCommand({
      subcommand: "dev",
      command: "seedVendorAccessDemo",
      args: {},
      url: runtime.url,
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(true);
    expect(runtime.capturedAll()).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "FORGE_SEED_DEV_PARTIAL_TENANTS",
      severity: "warning",
    });
    expect(result.nextActions).toEqual(["refresh the app UI", "forge inspect ui --ergonomics --json"]);
  });

  test("all-tenants reports a clear error when no frontend tenants exist", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    const result = await runSeedCommand({
      subcommand: "dev",
      command: "seedVendorAccessDemo",
      args: {},
      allTenants: true,
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: "FORGE_SEED_LOCAL_TENANTS_MISSING",
    });
    expect(result.nextActions).toEqual(["forge seed status --json"]);
  });

  test("status does not report auto-seed when the dev script lacks --seed", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo", "node bin/forge.mjs dev");
    const result = await runSeedCommand({
      subcommand: "status",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.readiness.autoSeedOnDev).toBe(false);
    expect(result.readiness.autoSeedAllTenantsOnDev).toBe(false);
    expect(result.readiness.autoSeedMode).toBe("none");
    expect(result.readiness.emptyWorkspaceRecovery[0]).toBe("forge dev --seed");
  });

  test("status normalizes recovery commands for a local ForgeOS checkout", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    mkdirSync(join(workspace, "bin"), { recursive: true });
    writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");

    const result = await runSeedCommand({
      subcommand: "status",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.nextActions).toEqual([
      "npm run dev",
      "node bin/forge.mjs seed dev --command seedVendorAccessDemo --json",
      "node bin/forge.mjs seed reset --command seedVendorAccessDemo --json",
    ]);
    expect(result.readiness.emptyWorkspaceRecovery).toEqual(result.nextActions);
    const human = formatSeedHuman(result);
    expect(human).toContain("empty workspace recovery:");
    expect(human).toContain("node bin/forge.mjs seed dev --command seedVendorAccessDemo --json");
  });

  test("status reports a requested seed command that does not exist", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    const result = await runSeedCommand({
      subcommand: "status",
      command: "seedMissingDemo",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.selectedCommand).toBeUndefined();
    expect(result.diagnostics[0]).toMatchObject({
      code: "FORGE_SEED_COMMAND_MISSING",
      message: "Seed command 'seedMissingDemo' was not found in generated runtimeGraph.json.",
    });
    expect(result.readiness).toMatchObject({
      ready: false,
      reason: "requested-command-missing",
      autoSeedOnDev: true,
      autoSeedAllTenantsOnDev: false,
      autoSeedMode: "default-tenant",
    });
    expect(result.nextActions).toEqual(["forge generate", "forge seed status --json"]);
  });

  test("missing seed diagnostics normalize suggested commands for local ForgeOS checkout", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    mkdirSync(join(workspace, "bin"), { recursive: true });
    writeFileSync(join(workspace, "bin", "forge.mjs"), "", "utf8");

    const result = await runSeedCommand({
      subcommand: "status",
      command: "seedMissingDemo",
      args: {},
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.nextActions).toEqual([
      "node bin/forge.mjs generate",
      "node bin/forge.mjs seed status --json",
    ]);
    expect(result.diagnostics[0]?.suggestedCommands).toEqual([
      "node bin/forge.mjs generate",
      "node bin/forge.mjs seed status --json",
    ]);
  });

  test("dev posts to the local Forge runtime with dev auth headers", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    const runtime = await fakeForgeRuntime();

    const result = await runSeedCommand({
      subcommand: "dev",
      command: "seedVendorAccessDemo",
      args: { source: "test" },
      url: runtime.url,
      userId: "owner@example.com",
      tenantId: "tenant-acme",
      role: "owner",
      permissions: ["demo:seed", "vendors:read"],
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.response?.status).toBe(200);
    expect(runtime.captured()).toMatchObject({
      method: "POST",
      url: "/commands/seedVendorAccessDemo",
      body: { args: { source: "test" } },
    });
    expect(runtime.captured().headers?.["x-forge-tenant-id"]).toBe("tenant-acme");
    expect(runtime.captured().headers?.["x-forge-permissions"]).toBe("[\"demo:seed\",\"vendors:read\"]");
  });

  test("reset passes reset=true to the selected seed command", async () => {
    const workspace = workspaceWithSeedCommand("seedVendorAccessDemo");
    const runtime = await fakeForgeRuntime();

    const result = await runSeedCommand({
      subcommand: "reset",
      args: { source: "test" },
      url: runtime.url,
      json: true,
      workspaceRoot: workspace,
    });

    expect(result.ok).toBe(true);
    expect(runtime.captured().body).toEqual({ args: { source: "test", reset: true } });
    expect(runtime.captured().headers?.["x-forge-user-id"]).toBe("forge-seed");
    expect(runtime.captured().headers?.["x-forge-tenant-id"]).toBe("11111111-1111-4111-8111-111111111111");
  });
});
