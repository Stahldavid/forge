import { command } from "forge/server";
import { z } from "zod";

const ticketSchema = z.object({
  title: z.string(),
  status: z.enum(["open", "pending", "closed"]).optional(),
});

export const createTicket = command({
  handler: async (ctx, args) => {
    const parsed = ticketSchema.parse(args);
    const row = await ctx.db.tickets.insert({
      title: parsed.title,
      status: parsed.status ?? "open",
    });

    await ctx.emit("ticket.created", {
      id: row.id,
      title: row.title,
      status: row.status,
    });

    return row;
  },
});
