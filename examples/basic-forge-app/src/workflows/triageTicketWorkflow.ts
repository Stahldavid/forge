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
      const result = await ctx.ai.generateText({
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: `Triage ticket: ${loaded.ticket.title}`,
        purpose: "ticket_triage",
      });
      const priority = result.text.toLowerCase().includes("urgent") ? "high" : "normal";
      return {
        priority,
        model: result.model,
        usage: result.usage,
      };
    }),
    step("captureTriageAnalytics", async (ctx) => {
      const triage = ctx.steps.triageWithAI?.output as {
        priority: string;
        model: string;
        usage: { totalTokens: number };
      };
      await ctx.telemetry.capture("workflow_ticket_triaged", {
        traceId: ctx.telemetry.traceId,
        priority: triage.priority,
        model: triage.model,
        tokens: triage.usage?.totalTokens,
      });
      return { captured: true, priority: triage.priority };
    }),
  ],
});
