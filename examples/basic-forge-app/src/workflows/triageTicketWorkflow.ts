import { event, step, workflow } from "forge/server";

export const triageTicketWorkflow = workflow({
  trigger: event("ticket.created"),
  steps: [
    step("loadTicket", async (ctx) => {
      const span = await ctx.telemetry.span("loadTicket");
      try {
        const input = ctx.input as { id: string };
        const ticket = await (ctx.db.tickets as { get: (id: string) => Promise<unknown> }).get(
          input.id,
        );
        return { ticket };
      } finally {
        await span.end();
      }
    }),
    step("triageWithAI", async (ctx) => {
      const loaded = ctx.steps.loadTicket?.output as { ticket: { title: string } };
      return {
        priority: loaded.ticket.title.toLowerCase().includes("urgent") ? "high" : "normal",
        model: "stub",
      };
    }),
    step("captureAnalytics", async (ctx) => {
      await ctx.telemetry.capture("workflow_ticket_triaged", {
        traceId: ctx.telemetry.traceId,
      });
      const triage = ctx.steps.triageWithAI?.output as { priority: string };
      return { captured: true, priority: triage.priority };
    }),
  ],
});
