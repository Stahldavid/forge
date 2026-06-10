import { event, step, workflow } from "forge/server";

export const triageTicketWorkflow = workflow({
  trigger: event("ticket.created"),
  steps: [
    step("loadTicket", async (ctx) => {
      const input = ctx.input as { ticketId: string };
      const ticket = await ctx.db.tickets.get(input.ticketId);

      return {
        ticket,
      };
    }),

    step("triageWithAI", async (ctx) => {
      const loaded = ctx.steps.loadTicket?.output as
        | { ticket?: { title?: string } }
        | undefined;
      const title = loaded?.ticket?.title ?? "Untitled support ticket";

      const result = await ctx.ai.generateText({
        provider: "openai",
        model: "mock",
        prompt: `Classify this support ticket: ${title}`,
        purpose: "ticket_triage",
      });

      return {
        triage: result.text,
        usage: result.usage,
      };
    }),

    step("saveTriage", async (ctx) => {
      const input = ctx.input as { ticketId: string };
      const triage = (ctx.steps.triageWithAI?.output as { triage?: string } | undefined)
        ?.triage;

      const updated = await ctx.db.tickets.update(input.ticketId, {
        triageSummary: triage ?? "Mock AI triage complete.",
        severity: "medium",
      });

      return {
        ticketId: updated.id,
      };
    }),

    step("captureTriageTelemetry", async (ctx) => {
      const input = ctx.input as { ticketId: string };
      await ctx.telemetry.capture("ticket_triaged", {
        ticketId: input.ticketId,
      });

      return {
        captured: true,
      };
    }),
  ],
});
