import { action } from "forge/server";

export const captureTicketCreated = action({
  event: "ticket.created",
  handler: async (ctx, event: { ticketId: string }) => {
    await ctx.telemetry.capture("ticket_created_action_processed", {
      ticketId: event.ticketId,
    });

    return {
      captured: true,
    };
  },
});
