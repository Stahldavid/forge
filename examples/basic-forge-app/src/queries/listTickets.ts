import { can, query } from "forge/server";

export const listTickets = query({
  auth: can("tickets.read"),
  handler: async (ctx) => {
    return ctx.db.tickets.all();
  },
});
