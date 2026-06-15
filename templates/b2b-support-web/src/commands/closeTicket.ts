import { can, command } from "forge/server";

export const closeTicket = command({
  auth: can("tickets.close"),
  handler: async (ctx, args) => {
    const input = args as { ticketId?: unknown };
    if (typeof input.ticketId !== "string" || input.ticketId.trim().length === 0) {
      throw new Error("ticketId is required");
    }

    const ticket = await ctx.db.tickets.update(input.ticketId, {
      status: "closed",
      updatedAt: new Date(),
    });
    if (!ticket) {
      throw new Error("ticket not found");
    }

    await ctx.emit("ticket.closed", {
      ticketId: ticket.id,
    });

    return ticket;
  },
});
