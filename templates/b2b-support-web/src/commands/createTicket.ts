import { can, command } from "forge/server";

export const createTicket = command({
  auth: can("tickets.create"),
  handler: async (ctx, input: { title: string }) => {
    const ticket = await ctx.db.tickets.insert({
      title: input.title,
      status: "open",
      severity: "medium",
    });

    await ctx.emit("ticket.created", {
      ticketId: ticket.id,
    });

    await ctx.telemetry.capture("ticket_created", {
      ticketId: ticket.id,
    });

    return ticket;
  },
});
