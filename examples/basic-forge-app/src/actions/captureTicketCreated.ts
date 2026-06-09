import { action } from "forge/server";

export const captureTicketCreated = action({
  event: "ticket.created",
  handler: async (ctx, event: { id: string; title?: string; status?: string; traceId?: string }) => {
    await ctx.telemetry.capture("ticket_created_action", {
      ticketId: event.id,
      traceId: event.traceId,
    });

    const ticket = await ctx.db.tickets.get(event.id);
    return {
      captured: true,
      ticketId: event.id,
      title: ticket?.title ?? event.title ?? null,
    };
  },
});
