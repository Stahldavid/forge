import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

export interface QueryWorkspace {
  root: string;
  tenantA: string;
  tenantB: string;
}

export async function scaffoldQueryWorkspace(prefix: string): Promise<QueryWorkspace> {
  const workspace = scaffoldGenerateWorkspace(prefix);
  writeFileSync(
    join(workspace, "src", "forge", "queries.ts"),
    "// query test workspace uses src/queries\n",
    "utf8",
  );
  const tenantA = "11111111-1111-1111-1111-111111111111";
  const tenantB = "22222222-2222-2222-2222-222222222222";

  writeFileSync(
    join(workspace, "src", "forge", "schema.ts"),
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
    join(workspace, "src", "policies.ts"),
    `
      import { canRole, definePolicies } from "forge/policy";
      export const policies = definePolicies({
        "tickets.read": canRole("owner", "admin", "member"),
        "tickets.create": canRole("owner", "admin", "member"),
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

  const generated = await run(defaultGenerateOptions(workspace));
  if (generated.exitCode !== 0) {
    throw new Error(`generate failed: ${generated.errors.map((e) => e.message).join("; ")}`);
  }

  return { root: workspace, tenantA, tenantB };
}

export { cleanupWorkspace, defaultGenerateOptions };
