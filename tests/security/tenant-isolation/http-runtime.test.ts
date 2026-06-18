import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORGE_TENANT_SCOPE_VIOLATION } from "../../../src/forge/compiler/diagnostics/codes.ts";
import { run } from "../../../src/forge/compiler/orchestrator/run.ts";
import { startDevServer } from "../../../src/forge/dev/server.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../../orchestrator/helpers.ts";

async function scaffoldHttpTenantWorkspace(prefix: string) {
  const root = scaffoldGenerateWorkspace(prefix);
  writeFileSync(
    join(root, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tickets = defineTable({
        name: "tickets",
        fields: {
          id: "uuid",
          tenantId: "text",
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
  writeFileSync(
    join(root, "src", "forge", "queries.ts"),
    `
      import { can, query } from "forge/server";
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
  return root;
}

function headers(tenantId: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "x-forge-user-id": `user-${tenantId}`,
    "x-forge-tenant-id": tenantId,
    "x-forge-role": "member",
  };
}

async function post<T>(url: string, path: string, tenantId: string, args: unknown): Promise<{ status: number; body: T }> {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: headers(tenantId),
    body: JSON.stringify({ args }),
  });
  return { status: response.status, body: (await response.json()) as T };
}

describe("security assurance: HTTP tenant isolation", () => {
  test("dev server HTTP APIs block cross-tenant reads and writes", async () => {
    const workspace = await scaffoldHttpTenantWorkspace("security-tenant-http");
    try {
      const handle = await startDevServer({
        workspaceRoot: workspace,
        host: "127.0.0.1",
        port: 0,
        mock: false,
        json: false,
        db: "memory",
      });

      try {
        const createA = await post<{ ok: boolean; result: { id: string; title: string } }>(
          handle.url,
          "/commands/createTicket",
          "tenant-a",
          { title: "A only" },
        );
        const createB = await post<{ ok: boolean; result: { id: string; title: string } }>(
          handle.url,
          "/commands/createTicket",
          "tenant-b",
          { title: "B only" },
        );
        expect(createA.status).toBe(200);
        expect(createB.status).toBe(200);
        expect(createA.body.ok).toBe(true);
        expect(createB.body.ok).toBe(true);

        const listB = await post<{ ok: boolean; result: Array<{ title: string }> }>(
          handle.url,
          "/queries/listTickets",
          "tenant-b",
          {},
        );
        expect(listB.body.result.map((row) => row.title)).toEqual(["B only"]);

        const getAFromB = await post<{ ok: boolean; result: unknown }>(
          handle.url,
          "/queries/getTicket",
          "tenant-b",
          { id: createA.body.result.id },
        );
        expect(getAFromB.status).toBe(200);
        expect(getAFromB.body.result).toBeNull();

        const updateAFromB = await post<{ ok: boolean; result: unknown }>(
          handle.url,
          "/commands/updateTicket",
          "tenant-b",
          { id: createA.body.result.id, title: "stolen" },
        );
        expect(updateAFromB.status).toBe(200);
        expect(updateAFromB.body.result).toBeNull();

        const deleteAFromB = await post<{ ok: boolean; result: boolean }>(
          handle.url,
          "/commands/deleteTicket",
          "tenant-b",
          { id: createA.body.result.id },
        );
        expect(deleteAFromB.status).toBe(200);
        expect(deleteAFromB.body.result).toBe(false);

        const findTenantAFromB = await post<{
          ok: boolean;
          diagnostics: Array<{ code: string }>;
        }>(handle.url, "/queries/findByTenant", "tenant-b", { tenantId: "tenant-a" });
        expect(findTenantAFromB.status).toBe(400);
        expect(findTenantAFromB.body.diagnostics.some((diagnostic) => diagnostic.code === FORGE_TENANT_SCOPE_VIOLATION)).toBe(true);

        const getAFromA = await post<{ ok: boolean; result: { title: string } }>(
          handle.url,
          "/queries/getTicket",
          "tenant-a",
          { id: createA.body.result.id },
        );
        expect(getAFromA.status).toBe(200);
        expect(getAFromA.body.result.title).toBe("A only");
      } finally {
        handle.stop();
      }
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 60_000);
});
