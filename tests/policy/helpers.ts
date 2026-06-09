import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";

export interface PolicyWorkspace {
  root: string;
  tenantA: string;
  tenantB: string;
}

export async function scaffoldPolicyWorkspace(prefix: string): Promise<PolicyWorkspace> {
  const workspace = scaffoldGenerateWorkspace(prefix);
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
        "billing.manage": canRole("owner", "admin"),
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
        handler: async (ctx, args) => {
          const row = await ctx.db.tickets.insert({
            title: args.title,
            status: "open",
          });
          await ctx.emit("ticket.created", { id: row.id, tenantId: row.tenant_id });
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
        handler: async (ctx) => ({ ok: true }),
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(commandsDir, "openCommand.ts"),
    `
      import { public_, command } from "forge/server";
      export const openCommand = command({
        auth: public_(),
        handler: async () => ({ ok: true }),
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

export { cleanupWorkspace };
