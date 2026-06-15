# Runtime by Example

This page shows how ForgeOS runtime pieces fit together in one feature.

Example: create support tickets, show them live in the UI, and triage them after commit with AI.

## Source layout

```txt
src/forge/schema.ts
src/policies.ts
src/commands/createTicket.ts
src/queries/listTickets.ts
src/queries/liveTickets.ts
src/actions/captureTicketCreated.ts
src/workflows/triageTicketWorkflow.ts
web/**
```

## Data

`src/forge/schema.ts`

```ts
export const tables = {
  tickets: {
    tenantScoped: true,
    fields: {
      id: "id",
      tenantId: "string",
      title: "string",
      status: "string",
      triageSummary: "string?",
    },
  },
};
```

Tenant-scoped tables must include tenant metadata so policies, generated clients, and RLS can enforce isolation.

## Policy

`src/policies.ts`

```ts
export const policies = {
  "tickets.read": ["owner", "admin", "member"],
  "tickets.create": ["owner", "admin", "member"],
};
```

Commands and queries declare policies. `forge check --json` reports missing or invalid policy wiring.

## Command

Commands are transactional writes:

```ts
export default command({
  auth: can("tickets.create"),
  handler: async (ctx, input) => {
    const ticket = await ctx.db.tickets.insert({
      title: input.title,
      status: "open",
    });

    ctx.emit("ticket.created", { ticketId: ticket.id });
    return ticket;
  },
});
```

Allowed:

- `ctx.db` writes;
- `ctx.emit`;
- buffered telemetry.

Forbidden:

- network SDK calls;
- direct secrets;
- `ctx.ai`;
- direct `process.env`.

## Query

Queries are read-only:

```ts
export default query({
  auth: can("tickets.read"),
  handler: async (ctx) => {
    return ctx.db.tickets.list();
  },
});
```

Queries may read tenant-scoped data. They must not write, emit events, call providers, or access secrets.

## LiveQuery

LiveQueries are read-only subscriptions:

```ts
export default liveQuery({
  auth: can("tickets.read"),
  handler: async (ctx) => {
    return ctx.db.tickets.list();
  },
});
```

Production liveQuery uses durable invalidations. Polling and notify paths are wakeups; the invalidation log is the source of truth.

## Action

Actions run after commit and may perform side effects:

```ts
export default action({
  event: "ticket.created",
  handler: async (ctx, event) => {
    ctx.telemetry?.capture("ticket.created", { ticketId: event.ticketId });
  },
});
```

Use actions for network calls, provider SDKs, secrets, and integration effects that should not run inside the command transaction.

## Workflow

Workflows orchestrate durable multi-step work:

```ts
export default workflow({
  trigger: "ticket.created",
  steps: {
    loadTicket: step(async (ctx, event) => {
      return ctx.db.tickets.get(event.ticketId);
    }),
    triageWithAI: step(async (ctx, ticket) => {
      return ctx.ai.generateText({
        provider: "openai",
        model: "gpt-4o-mini",
        prompt: `Summarize: ${ticket.title}`,
        purpose: "ticket_triage",
      });
    }),
  },
});
```

AI belongs in actions, workflows, endpoints, or server-only code. It does not belong in commands, queries, or liveQueries.

## UI flow

```txt
CreateTicketForm -> useCommand("createTicket")
TicketList       -> useLiveQuery("liveTickets")
```

Inspect frontend wiring:

```bash
forge inspect frontend --json
forge inspect capabilities --json
forge do connect-ui --json
```

## Verify the feature

```bash
forge generate
forge check --json
forge verify --standard
```

If a guard fails, read the diagnostic and use:

```bash
forge repair diagnose --from-last-test-run --json
```

## Related pages

- [Runtime Model](runtime-model.md)
- [Security and Data](security-and-data.md)
- [Frontend Integration Guide](frontend-integration-guide.md)
- [AI Agents](ai-agents.md)
