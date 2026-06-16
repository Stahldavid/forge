import { describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { SqlPlan } from "../../../src/forge/compiler/data-graph/sql/types.ts";
import { GENERATED_DIR } from "../../../src/forge/compiler/emitter/constants.ts";
import { run } from "../../../src/forge/compiler/orchestrator/run.ts";
import { stripDeterministicHeader } from "../../../src/forge/compiler/primitives/header.ts";
import { FORGE_TENANT_SCOPE_VIOLATION } from "../../../src/forge/compiler/diagnostics/codes.ts";
import { createMemoryAdapter } from "../../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../../src/forge/runtime/db/migrate.ts";
import type { AuthContext } from "../../../src/forge/runtime/auth/types.ts";
import type { TableMapEntry } from "../../../src/forge/compiler/data-graph/sql/serialize.ts";
import { runEntry } from "../../../src/forge/runtime/executor.ts";
import { runQuery } from "../../../src/forge/runtime/query/run-query.ts";
import { runLiveQuery } from "../../../src/forge/runtime/live/live-query-runner.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../../orchestrator/helpers.ts";

function readGeneratedJson<T>(workspace: string, artifact: string): T {
  return JSON.parse(
    stripDeterministicHeader(readFileSync(join(workspace, GENERATED_DIR, artifact), "utf8")),
  ) as T;
}

async function scaffoldTenantWorkspace(prefix: string) {
  const root = scaffoldGenerateWorkspace(prefix);
  const tenantA = "11111111-1111-1111-1111-111111111111";
  const tenantB = "22222222-2222-2222-2222-222222222222";

  writeFileSync(
    join(root, "src", "forge", "queries.ts"),
    `
      import { can, liveQuery, query } from "forge/server";
      export const listTickets = query({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.all(),
      });
      export const getTicket = query({
        auth: can("tickets.read"),
        handler: async (ctx, args: { id: string }) => ctx.db.tickets.get(args.id),
      });
      export const findByTenant = query({
        auth: can("tickets.read"),
        handler: async (ctx, args: { tenantId: string }) => ctx.db.tickets.where({ tenantId: args.tenantId }),
      });
      export const liveTickets = liveQuery({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.all(),
      });
    `,
    "utf8",
  );

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
        "tickets.read": canRole("owner", "admin", "member"),
        "tickets.create": canRole("owner", "admin", "member"),
        "tickets.update": canRole("owner", "admin", "member"),
        "tickets.delete": canRole("owner", "admin", "member"),
      });
    `,
    "utf8",
  );

  const commandsDir = join(root, "src", "commands");
  mkdirSync(commandsDir, { recursive: true });

  writeFileSync(
    join(commandsDir, "createTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const createTicket = command({
        auth: can("tickets.create"),
        handler: async (ctx, args: { title: string }) =>
          ctx.db.tickets.insert({ title: args.title, status: "open" }),
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(commandsDir, "spoofTenantTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const spoofTenantTicket = command({
        auth: can("tickets.create"),
        handler: async (ctx, args: { tenantId: string; title: string }) =>
          ctx.db.tickets.insert({ tenantId: args.tenantId, title: args.title, status: "open" }),
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(commandsDir, "updateTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const updateTicket = command({
        auth: can("tickets.update"),
        handler: async (ctx, args: { id: string; title: string }) =>
          ctx.db.tickets.update(args.id, { title: args.title }),
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(commandsDir, "deleteTicket.ts"),
    `
      import { can, command } from "forge/server";
      export const deleteTicket = command({
        auth: can("tickets.delete"),
        handler: async (ctx, args: { id: string }) => ctx.db.tickets.delete(args.id),
      });
    `,
    "utf8",
  );

  const generated = await run(defaultGenerateOptions(root));
  expect(generated.exitCode).toBe(0);
  return { root, tenantA, tenantB };
}

function auth(userId: string, tenantId: string): AuthContext {
  return {
    kind: "user",
    userId,
    tenantId,
    role: "member",
    roles: ["member"],
    permissions: [],
  };
}

describe("security assurance: runtime tenant isolation", () => {
  test("runtime APIs block cross-tenant read, write, spoof, and liveQuery access", async () => {
    const { root, tenantA, tenantB } = await scaffoldTenantWorkspace("security-tenant-runtime");
    const adapter = createMemoryAdapter();
    try {
      await applyMigrations(adapter, readGeneratedJson<SqlPlan>(root, "sqlPlan.json"));
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantA, "Tenant A"]);
      await adapter.query(`INSERT INTO tenants (id, name) VALUES ($1, $2)`, [tenantB, "Tenant B"]);

      const createA = await runEntry(root, "createTicket", {
        db: adapter,
        args: { title: "A only" },
        userId: "user-a",
        tenantId: tenantA,
        role: "member",
        json: true,
        mock: false,
      });
      const createB = await runEntry(root, "createTicket", {
        db: adapter,
        args: { title: "B only" },
        userId: "user-b",
        tenantId: tenantB,
        role: "member",
        json: true,
        mock: false,
      });
      expect(createA.ok).toBe(true);
      expect(createB.ok).toBe(true);
      const ticketA = createA.result as { id: string };
      const tableMap = readGeneratedJson<{ tableMap: Record<string, TableMapEntry> }>(root, "db.json").tableMap;

      const listB = await runQuery(root, "listTickets", {
        args: {},
        auth: auth("user-b", tenantB),
      }, { adapter, tableMap });
      expect((listB.result as Array<{ title: string }>).map((row) => row.title)).toEqual(["B only"]);

      const getAFromB = await runQuery(root, "getTicket", {
        args: { id: ticketA.id },
        auth: auth("user-b", tenantB),
      }, { adapter, tableMap });
      expect(getAFromB.ok).toBe(true);
      expect(getAFromB.result).toBeNull();

      const updateAFromB = await runEntry(root, "updateTicket", {
        db: adapter,
        args: { id: ticketA.id, title: "stolen" },
        userId: "user-b",
        tenantId: tenantB,
        role: "member",
        json: true,
        mock: false,
      });
      expect(updateAFromB.ok).toBe(true);
      expect(updateAFromB.result).toBeNull();

      const deleteAFromB = await runEntry(root, "deleteTicket", {
        db: adapter,
        args: { id: ticketA.id },
        userId: "user-b",
        tenantId: tenantB,
        role: "member",
        json: true,
        mock: false,
      });
      expect(deleteAFromB.ok).toBe(true);
      expect(deleteAFromB.result).toBe(false);

      const spoofInsert = await runEntry(root, "spoofTenantTicket", {
        db: adapter,
        args: { tenantId: tenantA, title: "spoofed" },
        userId: "user-b",
        tenantId: tenantB,
        role: "member",
        json: true,
        mock: false,
      });
      expect(spoofInsert.ok).toBe(false);
      expect(spoofInsert.diagnostics.some((diagnostic) => diagnostic.code === FORGE_TENANT_SCOPE_VIOLATION)).toBe(true);

      const findTenantAFromB = await runQuery(root, "findByTenant", {
        args: { tenantId: tenantA },
        auth: auth("user-b", tenantB),
      }, { adapter, tableMap });
      expect(findTenantAFromB.ok).toBe(false);
      expect(findTenantAFromB.diagnostics.some((diagnostic) => diagnostic.code === FORGE_TENANT_SCOPE_VIOLATION)).toBe(true);

      const liveB = await runLiveQuery(
        root,
        "liveTickets",
        { auth: auth("user-b", tenantB) },
        { adapter, tableMap },
      );
      expect(liveB.ok).toBe(true);
      expect((liveB.result as Array<{ title: string }>).map((row) => row.title)).toEqual(["B only"]);
      expect(liveB.dependencies).toContainEqual({ table: "tickets", tenantId: tenantB });

      const getAFromA = await runQuery(root, "getTicket", {
        args: { id: ticketA.id },
        auth: auth("user-a", tenantA),
      }, { adapter, tableMap });
      expect(getAFromA.ok).toBe(true);
      expect((getAFromA.result as { title: string }).title).toBe("A only");
    } finally {
      await adapter.close();
      cleanupWorkspace(root);
    }
  }, 60_000);
});
