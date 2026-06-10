import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TableMapEntry } from "../../src/forge/compiler/data-graph/sql/serialize.ts";
import type { SqlPlan } from "../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import type { DbAdapter } from "../../src/forge/runtime/db/adapter.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

export interface LiveWorkspace {
  root: string;
  tenantA: string;
  tenantB: string;
}

export async function scaffoldLiveWorkspace(prefix: string): Promise<LiveWorkspace> {
  const root = scaffoldGenerateWorkspace(prefix);
  const tenantA = "11111111-1111-1111-1111-111111111111";
  const tenantB = "22222222-2222-2222-2222-222222222222";

  writeFileSync(
    join(root, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tenants = defineTable({
        name: "tenants",
        fields: { id: "uuid", name: "text" },
      });
      export const tickets = defineTable({
        name: "tickets",
        fields: {
          id: "uuid",
          tenantId: "ref:tenants",
          title: "text",
          status: "text",
        },
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(root, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "tickets.read": canRole("member"),
        "tickets.create": canRole("member"),
      });
    `,
    "utf8",
  );

  const queriesDir = join(root, "src", "queries");
  const commandsDir = join(root, "src", "commands");
  mkdirSync(queriesDir, { recursive: true });
  mkdirSync(commandsDir, { recursive: true });

  writeFileSync(
    join(queriesDir, "liveTickets.ts"),
    `
      import { can, liveQuery } from "forge/server";
      export const liveTickets = liveQuery({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.where({ status: "open" }),
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(commandsDir, "createTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const createTicket = command({
        auth: can("tickets.create"),
        handler: async (ctx, args: { title: string }) => {
          return ctx.db.tickets.insert({ title: args.title, status: "open" });
        },
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(commandsDir, "failTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const failTicket = command({
        auth: can("tickets.create"),
        handler: async (ctx) => {
          await ctx.db.tickets.insert({ title: "rollback", status: "open" });
          throw new Error("boom");
        },
      });
    `,
    "utf8",
  );

  const generated = await run({
    workspaceRoot: root,
    check: false,
    dryRun: false,
    json: false,
    concurrency: 2,
  });
  if (generated.exitCode !== 0) {
    throw new Error(`generate failed: ${generated.errors.map((e) => e.message).join("; ")}`);
  }

  return { root, tenantA, tenantB };
}

export function readGeneratedJson<T>(root: string, name: string): T {
  return JSON.parse(
    stripDeterministicHeader(
      readFileSync(join(root, GENERATED_DIR, name), "utf8"),
    ),
  ) as T;
}

export async function createMigratedMemoryDb(root: string): Promise<{
  adapter: DbAdapter;
  tableMap: Record<string, TableMapEntry>;
}> {
  const adapter = createMemoryAdapter();
  await applyMigrations(adapter, readGeneratedJson<SqlPlan>(root, "sqlPlan.json"));
  const db = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(
    root,
    "db.json",
  );
  db.tableMap.tickets = {
    tableName: "tickets",
    tenantScoped: true,
    tenantIdColumn: "tenant_id",
    columns: [
      { name: "id", sqlType: "uuid", primaryKey: true },
      { name: "tenant_id", sqlType: "uuid" },
      { name: "title", sqlType: "text" },
      { name: "status", sqlType: "text" },
    ],
  };
  writeFileSync(
    join(root, GENERATED_DIR, "db.json"),
    JSON.stringify({ tableMap: db.tableMap }),
    "utf8",
  );
  return { adapter, tableMap: db.tableMap };
}

export function cleanupLiveWorkspace(root: string): void {
  cleanupWorkspace(root);
  rmSync(join(root, ".forge"), { recursive: true, force: true });
}
