import { can, query } from "forge/server";

export const getTicket = query({
  auth: can("tickets.read"),
  handler: async (ctx, input: { ticketId: string }) => ctx.db.tickets.get(input.ticketId),
});
