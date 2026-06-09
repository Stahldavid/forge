import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldGenerateWorkspace,
} from "../orchestrator/helpers.ts";

export { cleanupWorkspace, defaultGenerateOptions };

export function scaffoldWorkflowWorkspace(prefix: string) {
  const workspace = scaffoldGenerateWorkspace(prefix);
  const commandsDir = join(workspace, "src", "commands");
  const workflowsDir = join(workspace, "src", "workflows");
  mkdirSync(commandsDir, { recursive: true });
  mkdirSync(workflowsDir, { recursive: true });

  writeFileSync(
    join(workspace, "src", "forge", "schema.ts"),
    `
      import { defineTable } from "forge/server";
      export const tickets = defineTable({
        name: "tickets",
        fields: { id: "uuid", title: "text", status: "text" },
      });
    `,
    "utf8",
  );

  writeFileSync(
    join(commandsDir, "createTicket.ts"),
    `
      import { command } from "forge/server";
      export const createTicket = command({
        handler: async (ctx, args) => {
          const row = await ctx.db.tickets.insert({ title: args.title, status: "open" });
          await ctx.emit("ticket.created", { id: row.id, title: row.title, status: row.status });
          return row;
        },
      });
    `,
    "utf8",
  );

  return { workspace, workflowsDir };
}

export function writeTriageWorkflow(workflowsDir: string, options?: { failingStep?: string }) {
  const failingBody =
    options?.failingStep === "triageWithAI"
      ? `step("triageWithAI", async () => { throw new Error("triage failed"); }),`
      : `step("triageWithAI", async (ctx) => {
          const loaded = ctx.steps.loadTicket?.output;
          return { priority: "normal", model: "stub" };
        }),`;

  writeFileSync(
    join(workflowsDir, "triageTicketWorkflow.ts"),
    `
      import { event, step, workflow } from "forge/server";
      export const triageTicketWorkflow = workflow({
        trigger: event("ticket.created"),
        steps: [
          step("loadTicket", async (ctx) => {
            const input = ctx.input;
            const ticket = await ctx.db.tickets.get(input.id);
            return { ticket };
          }),
          ${failingBody}
          step("captureAnalytics", async (ctx) => {
            return { captured: true, priority: ctx.steps.triageWithAI?.output?.priority ?? "normal" };
          }),
        ],
      });
    `,
    "utf8",
  );
}
