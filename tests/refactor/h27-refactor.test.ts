import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { runRefactorCommand } from "../../src/forge/cli/refactor.ts";
import { cleanupWorkspace } from "../orchestrator/helpers.ts";
import { refactorOptions, scaffoldRefactorWorkspace } from "./h27-helpers.ts";

describe("H27 safe refactor", () => {
  test("rename field plans migration hint, dry-run leaves files untouched, apply and rollback work", async () => {
    const root = scaffoldRefactorWorkspace("h27-field");
    try {
      const dryRun = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "field",
          from: "tickets.priority",
          to: "tickets.urgency",
          dryRun: true,
        }),
      );
      expect(dryRun.ok).toBe(true);
      expect(dryRun.plan?.migrationPlan?.sql[0]).toBe(
        "ALTER TABLE tickets RENAME COLUMN priority TO urgency;",
      );
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "priority",
      );

      const applied = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "field",
          from: "tickets.priority",
          to: "tickets.urgency",
          yes: true,
        }),
      );
      expect(applied.ok).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "urgency",
      );
      expect(readFileSync(join(root, "src", "queries", "liveTickets.ts"), "utf8")).toContain(
        "urgency",
      );
      expect(applied.plan?.filesToModify.some((patch) => patch.file.startsWith("src/forge/_generated"))).toBe(false);

      const rollback = await runRefactorCommand(
        refactorOptions(root, {
          action: "rollback",
          planId: applied.plan?.id,
        }),
      );
      expect(rollback.ok).toBe(true);
      expect(readFileSync(join(root, "src", "forge", "schema.ts"), "utf8")).toContain(
        "priority",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("rename field rewrites only table-scoped TS/JSON references without renaming locals", async () => {
    const root = scaffoldRefactorWorkspace("h27-field-ast");
    try {
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
          export const projects = defineTable({
            name: "projects",
            fields: {
              id: "uuid",
              priority: "text",
            },
          });
        `,
        "utf8",
      );
      writeFileSync(
        join(root, "src", "commands", "updateTicketPriority.ts"),
        `
          import { can, command } from "forge/server";
          export const updateTicketPriority = command({
            auth: can("tickets.update"),
            handler: async (ctx, input: { id: string; priority: string }) => {
              const priority = input.priority;
              const { priority: existingPriority } = input;
              const payload = { priority };
              return ctx.db.tickets.update(input.id, {
                ...payload,
                priority: existingPriority,
              });
            },
          });
        `,
        "utf8",
      );
      writeFileSync(
        join(root, "web", "components", "PriorityBadge.tsx"),
        `
          export function PriorityBadge(props: { priority: string }) {
            const priority = props.priority;
            return <span data-field="priority" priority={priority}>{props.priority}</span>;
          }
        `,
        "utf8",
      );
      writeFileSync(
        join(root, ".forge", "blueprints", "project-priority.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          name: "project-priority",
          changes: [
            { kind: "addField", table: "projects", field: { name: "priority", type: "text" } },
          ],
        }),
        "utf8",
      );

      const applied = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "field",
          from: "tickets.priority",
          to: "tickets.urgency",
          yes: true,
        }),
      );

      expect(applied.ok).toBe(true);
      const modifiedFiles = applied.plan?.filesToModify.map((patch) => patch.file) ?? [];
      expect(modifiedFiles).not.toContain("web/components/PriorityBadge.tsx");

      const schemaSource = readFileSync(join(root, "src", "forge", "schema.ts"), "utf8");
      expect(schemaSource).toContain('urgency: "text"');
      expect(schemaSource).toContain("export const projects = defineTable");
      expect(schemaSource).toContain('priority: "text"');

      const commandSource = readFileSync(join(root, "src", "commands", "updateTicketPriority.ts"), "utf8");
      expect(commandSource).toContain("const priority = input.urgency;");
      expect(commandSource).toContain("const { urgency: existingPriority } = input;");
      expect(commandSource).toContain("const payload = { urgency: priority };");
      expect(commandSource).toContain("urgency: existingPriority");
      expect(commandSource).not.toContain("const urgency = input");

      const componentSource = readFileSync(join(root, "web", "components", "PriorityBadge.tsx"), "utf8");
      expect(componentSource).toContain("props: { priority: string }");
      expect(componentSource).toContain("const priority = props.priority;");
      expect(componentSource).toContain('data-field="priority"');
      expect(componentSource).toContain("priority={priority}");

      const blueprintSource = readFileSync(join(root, ".forge", "blueprints", "ticket-priority.json"), "utf8");
      expect(blueprintSource).toContain('"name": "urgency"');
      expect(blueprintSource).not.toContain('"name": "priority"');

      const projectBlueprintSource = readFileSync(join(root, ".forge", "blueprints", "project-priority.json"), "utf8");
      const projectBlueprint = JSON.parse(projectBlueprintSource) as {
        changes: Array<{ table: string; field: { name: string } }>;
      };
      expect(projectBlueprint.changes[0]?.table).toBe("projects");
      expect(projectBlueprint.changes[0]?.field.name).toBe("priority");
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("rename table is high risk unless explicitly allowed", async () => {
    const root = scaffoldRefactorWorkspace("h27-table");
    try {
      const blocked = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "table",
          from: "tickets",
          to: "supportTickets",
          yes: true,
        }),
      );
      expect(blocked.ok).toBe(false);
      expect(blocked.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_REFACTOR_HIGH_RISK",
      );

      const planned = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "table",
          from: "tickets",
          to: "supportTickets",
          dryRun: true,
        }),
      );
      expect(planned.plan?.migrationPlan?.sql[0]).toBe(
        "ALTER TABLE tickets RENAME TO supportTickets;",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("rename table rewrites structured TS and JSON references when explicitly allowed", async () => {
    const root = scaffoldRefactorWorkspace("h27-table-ast");
    try {
      writeFileSync(
        join(root, "src", "commands", "updateTicketPriority.ts"),
        `
          import { can, command } from "forge/server";
          export const updateTicketPriority = command({
            auth: can("tickets.update"),
            handler: async (ctx, input: { id: string; priority: string }) => {
              const tickets = ["keep-local"];
              const row = await ctx.db.tickets.update(input.id, { priority: input.priority });
              return { row, local: tickets };
            },
          });
        `,
        "utf8",
      );
      const applied = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "table",
          from: "tickets",
          to: "supportTickets",
          yes: true,
          allowHighRisk: true,
        }),
      );

      expect(applied.ok).toBe(true);
      const schemaSource = readFileSync(join(root, "src", "forge", "schema.ts"), "utf8");
      expect(schemaSource).toContain("export const supportTickets = defineTable");
      expect(schemaSource).toContain('name: "supportTickets"');

      const commandSource = readFileSync(join(root, "src", "commands", "updateTicketPriority.ts"), "utf8");
      expect(commandSource).toContain("ctx.db.supportTickets.update");
      expect(commandSource).toContain('auth: can("supportTickets.update")');
      expect(commandSource).toContain('const tickets = ["keep-local"];');
      expect(commandSource).toContain("local: tickets");

      const policiesSource = readFileSync(join(root, "src", "policies.ts"), "utf8");
      expect(policiesSource).toContain('"supportTickets.read"');
      expect(policiesSource).toContain('"supportTickets.update"');

      const blueprintSource = readFileSync(join(root, ".forge", "blueprints", "ticket-priority.json"), "utf8");
      expect(blueprintSource).toContain('"table": "supportTickets"');
      expect(blueprintSource).not.toContain('"table": "tickets"');
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("replace-process-env rewrites server ctx usage and rejects client files", async () => {
    const root = scaffoldRefactorWorkspace("h27-env");
    try {
      writeFileSync(
        join(root, "src", "commands", "useSecret.ts"),
        `
          import { command } from "forge/server";
          export const useSecret = command({
            handler: async (ctx) => process.env.STRIPE_SECRET_KEY,
          });
        `,
        "utf8",
      );
      const replaced = await runRefactorCommand(
        refactorOptions(root, {
          action: "replace-process-env",
          from: "STRIPE_SECRET_KEY",
          yes: true,
        }),
      );
      expect(replaced.ok).toBe(true);
      expect(readFileSync(join(root, "src", "commands", "useSecret.ts"), "utf8")).toContain(
        'ctx.secrets.get("STRIPE_SECRET_KEY")',
      );

      writeFileSync(
        join(root, "web", "components", "SecretBadge.tsx"),
        `export function SecretBadge() { return <span>{process.env.STRIPE_SECRET_KEY}</span>; }`,
        "utf8",
      );
      const client = await runRefactorCommand(
        refactorOptions(root, {
          action: "replace-process-env",
          from: "STRIPE_SECRET_KEY",
          dryRun: true,
        }),
      );
      expect(client.ok).toBe(false);
      expect(client.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
        "FORGE_REFACTOR_SECRET_IN_CLIENT",
      );
    } finally {
      cleanupWorkspace(root);
    }
  });

  test("rename command rewrites export, file, capability-map UI bindings, and raw fetch paths", async () => {
    const root = scaffoldRefactorWorkspace("h27-rename-command");
    try {
      writeFileSync(
        join(root, "web", "components", "TicketPriorityForm.tsx"),
        `
          import { api, commands, useCommand } from "../lib/forge";
          export function TicketPriorityForm() {
            const updateTicketPriority = "local-label";
            const direct = commands.updateTicketPriority;
            const byApi = useCommand(api.commands.updateTicketPriority);
            const byName = useCommand("updateTicketPriority");
            const raw = fetch("/commands/updateTicketPriority");
            const rawWithQuery = fetch("http://127.0.0.1:3765/commands/updateTicketPriority?debug=1");
            return <button onClick={() => byApi.run({ id: "1", priority: "high" })}>{updateTicketPriority}</button>;
          }
        `,
        "utf8",
      );
      writeFileSync(
        join(root, "web", "components", "UnrelatedRuntimeMetadata.tsx"),
        `
          import "../commands/updateTicketPriorityHelpers";
          const api = { commands: { updateTicketPriority: "local-api-value" } };
          const byLocalApi = api.commands.updateTicketPriority;
          const direct = commands.updateTicketPriority;
          export const metadata = {
            name: "updateTicketPriority",
            event: "updateTicketPriority",
            command: "updateTicketPriority",
            label: "updateTicketPriority",
          };
          export const route = "/commands/updateTicketPriorityExtra";
        `,
        "utf8",
      );
      writeFileSync(
        join(root, ".forge", "blueprints", "ticket-command.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          name: "ticket-command",
          command: "updateTicketPriority",
          commands: ["updateTicketPriority"],
          node: { kind: "command", name: "updateTicketPriority" },
        }),
        "utf8",
      );
      writeFileSync(
        join(root, ".forge", "blueprints", "unrelated-runtime-metadata.json"),
        JSON.stringify({
          schemaVersion: "0.1.0",
          name: "updateTicketPriority",
          event: "updateTicketPriority",
          commandLabel: "updateTicketPriority",
          labels: ["updateTicketPriority"],
          metadata: { name: "updateTicketPriority" },
        }),
        "utf8",
      );

      const applied = await runRefactorCommand(
        refactorOptions(root, {
          renameTarget: "command",
          from: "updateTicketPriority",
          to: "setTicketPriority",
          yes: true,
        }),
      );

      expect(applied.ok).toBe(true);
      expect(existsSync(join(root, "src", "commands", "setTicketPriority.ts"))).toBe(true);
      expect(existsSync(join(root, "src", "commands", "updateTicketPriority.ts"))).toBe(false);

      const commandSource = readFileSync(join(root, "src", "commands", "setTicketPriority.ts"), "utf8");
      expect(commandSource).toContain("export const setTicketPriority = command");

      const uiSource = readFileSync(join(root, "web", "components", "TicketPriorityForm.tsx"), "utf8");
      expect(uiSource).toContain("api.commands.setTicketPriority");
      expect(uiSource).toContain("commands.setTicketPriority");
      expect(uiSource).toContain('useCommand("setTicketPriority")');
      expect(uiSource).toContain('fetch("/commands/setTicketPriority")');
      expect(uiSource).toContain('fetch("http://127.0.0.1:3765/commands/setTicketPriority?debug=1")');
      expect(uiSource).toContain('const updateTicketPriority = "local-label"');

      const unrelatedTsSource = readFileSync(join(root, "web", "components", "UnrelatedRuntimeMetadata.tsx"), "utf8");
      expect(unrelatedTsSource).toContain('import "../commands/updateTicketPriorityHelpers";');
      expect(unrelatedTsSource).toContain("api.commands.updateTicketPriority");
      expect(unrelatedTsSource).toContain("commands.updateTicketPriority");
      expect(unrelatedTsSource).toContain('name: "updateTicketPriority"');
      expect(unrelatedTsSource).toContain('event: "updateTicketPriority"');
      expect(unrelatedTsSource).toContain('command: "updateTicketPriority"');
      expect(unrelatedTsSource).toContain('label: "updateTicketPriority"');
      expect(unrelatedTsSource).toContain('"/commands/updateTicketPriorityExtra"');

      const blueprintSource = readFileSync(join(root, ".forge", "blueprints", "ticket-command.json"), "utf8");
      expect(blueprintSource).toContain('"command": "setTicketPriority"');
      expect(blueprintSource).toContain('"commands": [\n    "setTicketPriority"\n  ]');
      expect(blueprintSource).toContain('"kind": "command"');
      expect(blueprintSource).toContain('"name": "setTicketPriority"');
      expect(blueprintSource).not.toContain('"command": "updateTicketPriority"');

      const unrelatedJsonSource = readFileSync(join(root, ".forge", "blueprints", "unrelated-runtime-metadata.json"), "utf8");
      const unrelatedJson = JSON.parse(unrelatedJsonSource) as {
        name: string;
        event: string;
        commandLabel: string;
        labels: string[];
        metadata: { name: string };
      };
      expect(unrelatedJson.name).toBe("updateTicketPriority");
      expect(unrelatedJson.event).toBe("updateTicketPriority");
      expect(unrelatedJson.commandLabel).toBe("updateTicketPriority");
      expect(unrelatedJson.labels).toEqual(["updateTicketPriority"]);
      expect(unrelatedJson.metadata.name).toBe("updateTicketPriority");
    } finally {
      cleanupWorkspace(root);
    }
  });
});
