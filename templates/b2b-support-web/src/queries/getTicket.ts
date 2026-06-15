import { can, query } from "forge/server";

export const getTicket = query({
  auth: can("tickets.read"),
  handler: async (ctx, args) => {
    const input = args as { ticketId?: unknown };
    if (typeof input.ticketId !== "string" || input.ticketId.trim().length === 0) {
      throw new Error("ticketId is required");
    }

    return ctx.db.tickets.get(input.ticketId);
  },
});
