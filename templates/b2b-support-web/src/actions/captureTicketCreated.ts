import { action } from "forge/server";

export const captureTicketCreated = action({
  event: "ticket.created",
  handler: async (ctx, event) => {
    const payload = event as { ticketId?: unknown };
    if (typeof payload.ticketId !== "string" || payload.ticketId.trim().length === 0) {
      throw new Error("ticketId is required");
    }

    await ctx.telemetry.capture("ticket_created_action_processed", {
      ticketId: payload.ticketId,
    });

    return {
      captured: true,
    };
  },
});
