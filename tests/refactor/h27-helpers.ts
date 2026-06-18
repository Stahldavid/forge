import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RefactorCommandOptions } from "../../src/forge/refactor/types.ts";
import { tempWorkspace } from "../orchestrator/helpers.ts";

const PACKAGE_FIXTURES = join(import.meta.dir, "..", "fixtures", "packages");

export function refactorOptions(
  workspaceRoot: string,
  overrides: Partial<RefactorCommandOptions>,
): RefactorCommandOptions {
  return {
    action: "rename",
    workspaceRoot,
    json: true,
    dryRun: false,
    plan: false,
    yes: false,
    force: false,
    allowHighRisk: false,
    noGenerate: true,
    noVerify: true,
    keepFailed: false,
    ...overrides,
  };
}

export function scaffoldRefactorWorkspace(prefix: string): string {
  const root = tempWorkspace(prefix);
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "forge-refactor-test",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
        },
        include: ["src/**/*.ts", "web/**/*.tsx"],
      },
      null,
      2,
    ),
    "utf8",
  );
  mkdirSync(join(root, "node_modules"), { recursive: true });
  cpSync(join(PACKAGE_FIXTURES, "forge"), join(root, "node_modules", "forge"), {
    recursive: true,
    force: true,
  });
  cpSync(join(PACKAGE_FIXTURES, "stripe"), join(root, "node_modules", "stripe"), {
    recursive: true,
    force: true,
  });
  mkdirSync(join(root, "src", "forge"), { recursive: true });
  mkdirSync(join(root, "src", "forge", "_generated"), { recursive: true });
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
          priority: "text",
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
        "tickets.update": canRole("owner", "admin", "member"),
      });
    `,
    "utf8",
  );
  mkdirSync(join(root, "src", "commands"), { recursive: true });
  mkdirSync(join(root, "src", "queries"), { recursive: true });
  mkdirSync(join(root, "src", "actions"), { recursive: true });
  mkdirSync(join(root, "web", "components"), { recursive: true });
  mkdirSync(join(root, ".forge", "blueprints"), { recursive: true });
  writeFileSync(
    join(root, "src", "commands", "updateTicketPriority.ts"),
    `
      import { can, command } from "forge/server";
      export const updateTicketPriority = command({
        auth: can("tickets.update"),
        handler: async (ctx, input: { id: string; priority: string }) => {
          return ctx.db.tickets.update(input.id, { priority: input.priority });
        },
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "src", "queries", "liveTickets.ts"),
    `
      import { can, liveQuery } from "forge/server";
      export const liveTickets = liveQuery({
        auth: can("tickets.read"),
        handler: async (ctx) => ctx.db.tickets.where({ priority: "high" }),
      });
    `,
    "utf8",
  );
  writeFileSync(
    join(root, "web", "components", "PriorityBadge.tsx"),
    `
      export function PriorityBadge(props: { priority: string }) {
        return <span>{props.priority}</span>;
      }
    `,
    "utf8",
  );
  writeFileSync(
    join(root, ".forge", "blueprints", "ticket-priority.json"),
    JSON.stringify({
      schemaVersion: "0.1.0",
      name: "ticket-priority",
      changes: [
        { kind: "addField", table: "tickets", field: { name: "priority", type: "text" } },
      ],
    }),
    "utf8",
  );
  return root;
}
