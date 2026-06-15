# Frontend Integration Guide

ForgeOS treats frontend wiring as part of the generated app contract.

The goal is for an agent to answer: which route calls which command, which query powers which view, and which liveQuery updates which screen?

## Expected structure

```txt
web/
  src/ or app/
  lib/forge.ts
  components/**
src/forge/_generated/
  client.ts
  react.ts
  frontendGraph.json
  capabilityMap.json
```

The local bridge file should import generated Forge hooks and expose one stable path to app components.

## Provider

Mount `ForgeProvider` near the root of the web app.

Local development usually uses dev auth:

```tsx
<ForgeProvider
  baseUrl={forgeUrl}
  devAuth={{
    userId: "dev-user",
    tenantId: "dev-tenant",
    role: "owner",
  }}
>
  {children}
</ForgeProvider>
```

Production apps should use the configured auth mode and pass bearer tokens through the client transport.

## Hooks

Use generated hooks instead of raw fetches:

```tsx
const tickets = useLiveQuery("liveTickets", {});
const createTicket = useCommand("createTicket");
const ticket = useQuery("getTicket", { id });
```

This keeps UI calls visible to `frontendGraph.json` and `capabilityMap.json`.

## Capability map

Inspect the UI/backend connection:

```bash
forge inspect frontend --json
forge inspect capabilities --json
forge do connect-ui --json
```

Capability map diagnostics help find:

- runtime entries with no UI caller;
- UI calls to missing commands or queries;
- raw runtime fetches;
- missing `ForgeProvider`;
- bridge files not using generated hooks;
- routes that should subscribe to liveQuery but do not.

## Anti-patterns

Avoid:

```tsx
fetch(`${apiUrl}/commands/createTicket`, { method: "POST" });
```

Prefer:

```tsx
const createTicket = useCommand("createTicket");
await createTicket.mutate({ title });
```

Avoid importing generated files throughout the app. Keep generated imports behind `web/lib/forge.ts` so agents have one bridge to inspect.

## Local dev

```bash
forge dev
forge dev --once --json
```

Open the web URL for the app. The API URL is for JSON runtime calls and health checks.

## Add a frontend shell

```bash
forge make ui --framework vite --dry-run --json
forge make ui --framework vite --yes
forge generate
forge inspect frontend --json
```

For a resource with UI:

```bash
forge make resource notes --fields title:text,status:enum(open,done) --with-ui --dry-run --json
```

## Verify frontend wiring

```bash
forge dev --once --json
forge inspect capabilities --json
forge ui smoke --json
forge verify --standard
```

## Related pages

- [Frontend](frontend.md)
- [Dev Loop](dev-loop.md)
- [Runtime by Example](runtime-by-example.md)
- [Testing and Repair](testing-and-repair.md)
