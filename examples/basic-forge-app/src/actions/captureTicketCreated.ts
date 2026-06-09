import { action } from "forge/server";

export const captureTicketCreated = action({
  event: "ticket.created",
  handler: async (ctx, event: { id: string; title?: string; status?: string }) => {
    const ticket = await ctx.db.tickets.get(event.id);
    return {
      captured: true,
      ticketId: event.id,
      title: ticket?.title ?? event.title ?? null,
    };
  },
});
