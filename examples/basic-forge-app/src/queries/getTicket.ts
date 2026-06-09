import { can, query } from "forge/server";

export const getTicket = query({
  auth: can("tickets.read"),
  handler: async (ctx, args: { id: string }) => {
    return ctx.db.tickets.get(args.id);
  },
});
