import { can, liveQuery } from "forge/server";

export const liveTickets = liveQuery({
  auth: can("tickets.read"),
  handler: async (ctx) =>
    ctx.db.tickets.where({
      status: "open",
    }),
});
