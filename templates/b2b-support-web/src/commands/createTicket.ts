import { can, command } from "forge/server";

async function ensureTenant(ctx: {
  auth?: { tenantId?: string | null };
  db: Record<
    string,
    {
      get(id: string): Promise<Record<string, unknown> | null>;
      insert(value: Record<string, unknown>): Promise<Record<string, unknown>>;
    }
  >;
}) {
  if (!ctx.auth?.tenantId) {
    throw new Error("tenant auth is required");
  }

  const existing = await ctx.db.tenants.get(ctx.auth.tenantId);
  if (!existing) {
    await ctx.db.tenants.insert({
      id: ctx.auth.tenantId,
    });
  }
}

export const createTicket = command({
  auth: can("tickets.create"),
  handler: async (ctx, input: { title: string }) => {
    await ensureTenant(ctx);

    const ticket = await ctx.db.tickets.insert({
      title: input.title,
      status: "open",
      severity: "medium",
      triageSummary: "Waiting for workflow triage.",
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
