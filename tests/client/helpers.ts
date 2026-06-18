import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../src/forge/dev/server.ts";
import type { DevServerHandle } from "../../src/forge/dev/types.ts";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

export interface ClientWorkspace {
  root: string;
  tenantA: string;
  tenantB: string;
}

export async function scaffoldClientWorkspace(
  prefix: string,
  options: { generate?: boolean } = {},
): Promise<ClientWorkspace> {
  const workspace = scaffoldGenerateWorkspace(prefix);
  const shouldGenerate = options.generate ?? true;
  const tenantA = "11111111-1111-1111-1111-111111111111";
  const tenantB = "22222222-2222-2222-2222-222222222222";

  writeFileSync(
    join(workspace, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tenants = defineTable("tenants", {
        id: "uuid",
      });
      export const tickets = defineTable("tickets", {
        id: "uuid",
        tenantId: "ref:tenants",
        title: "text",
        status: "text",
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(workspace, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "tickets.read": canRole("owner", "admin", "member"),
        "tickets.create": canRole("owner", "admin", "member"),
        "billing.manage": canRole("owner", "admin"),
      });
    `,
    "utf8",
  );

  const queriesDir = join(workspace, "src", "queries");
  mkdirSync(queriesDir, { recursive: true });

  writeFileSync(
    join(queriesDir, "listTickets.ts"),
    `
      import { can, query } from "forge/server";
      export const listTickets = query({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.all(),
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(queriesDir, "getTicket.ts"),
    `
      import { can, query } from "forge/server";
      export const getTicket = query({
        auth: can("tickets.read"),
        handler: async (ctx, args: { id: string }) => ctx.db.tickets.get(args.id),
      });
    `,
    "utf8",
  );

  const commandsDir = join(workspace, "src", "commands");
  mkdirSync(commandsDir, { recursive: true });

  writeFileSync(
    join(commandsDir, "createTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const createTicket = command({
        auth: can("tickets.create"),
        handler: async (ctx, args: { title: string }) => {
          const row = await ctx.db.tickets.insert({
            title: args.title,
            status: "open",
          });
          return row;
        },
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(commandsDir, "manageBilling.ts"),
    `
      import { can, command } from "forge/server";
      export const manageBilling = command({
        auth: can("billing.manage"),
        handler: async () => ({ ok: true }),
      });
    `,
    "utf8",
  );

  if (shouldGenerate) {
    const generated = await run(defaultGenerateOptions(workspace));
    if (generated.exitCode !== 0) {
      throw new Error(`generate failed: ${generated.errors.map((e) => e.message).join("; ")}`);
    }
  }

  return { root: workspace, tenantA, tenantB };
}

function resetPgliteDir(workspace: string): void {
  const dataDir = join(workspace, ".forge", "pglite");
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
}

export async function seedClientDatabase(
  adapter: DbAdapter,
  tenantA: string,
  tenantB: string,
  options?: { seedTickets?: boolean },
): Promise<void> {
  await adapter.query(`INSERT INTO tenants (id) VALUES ($1)`, [tenantA]);
  await adapter.query(`INSERT INTO tenants (id) VALUES ($1)`, [tenantB]);

  if (options?.seedTickets) {
    await adapter.query(
      `INSERT INTO tickets (id, tenant_id, title, status) VALUES ($1, $2, 'tenant-a-ticket', 'open')`,
      ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", tenantA],
    );
    await adapter.query(
      `INSERT INTO tickets (id, tenant_id, title, status) VALUES ($1, $2, 'tenant-b-ticket', 'open')`,
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", tenantB],
    );
  }
}

export async function startClientDevServer(
  workspace: string,
  options: { db?: "memory" | "pglite" | "none" } = {},
): Promise<DevServerHandle> {
  const db = options.db ?? "memory";
  if (db === "pglite") {
    resetPgliteDir(workspace);
  }
  const handle = await startDevServer({
    workspaceRoot: workspace,
    host: "127.0.0.1",
    port: 0,
    mock: false,
    json: false,
    db,
    worker: false,
    telemetry: ["local"],
  });

  if (db !== "none" && !handle.state.adapter) {
    throw new Error("dev server started without database adapter");
  }

  return handle;
}

export async function prepareClientDatabase(
  workspace: string,
  tenantA: string,
  tenantB: string,
  options?: { db?: "memory" | "pglite"; seedTickets?: boolean },
): Promise<DevServerHandle> {
  const handle = await startClientDevServer(workspace, { db: options?.db ?? "memory" });
  await seedClientDatabase(handle.state.adapter!, tenantA, tenantB, options);
  return handle;
}

export { cleanupWorkspace };
