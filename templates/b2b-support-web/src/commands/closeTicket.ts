import { can, command } from "forge/server";

export const closeTicket = command({
  auth: can("tickets.close"),
  handler: async (ctx, input: { ticketId: string }) => {
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
