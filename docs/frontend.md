# Frontend

ForgeOS generates a **typed client SDK** plus framework bindings so web apps call commands, queries, and liveQueries through the same runtime surface as the backend, not ad-hoc fetch URLs.

## Architecture

```text
React or Vue component
  -> web/lib/forge.ts or web/composables/forge.ts (bridge)
  -> useCommand / useQuery / useLiveQuery
  -> or useForgeCommand / useForgeQuery / useForgeLiveQuery
  -> Forge dev server
  -> commands / queries / liveQueries
  -> database

Database change -> invalidation log -> liveQuery SSE -> hooks -> UI
```

| Layer | Responsibility |
|-------|----------------|
| React/Vue components | UI, forms, lists |
| `web/lib/forge.ts` or `web/composables/forge.ts` | Generated bridge to client SDK |
| `ForgeProvider` or Nuxt plugin | API URL, dev auth headers |
| Generated hooks/composables | Typed runtime calls |
| Capability map | Links UI actions to backend entries |

## Frontend contract

ForgeOS treats the frontend as part of the app contract. The compiler records routes, components, generated bridge files, hook usage, provider setup, direct runtime fetches, and backend bindings.

That gives humans and agents concrete answers:

- Which route uses `createTicket`?
- Which component subscribes to `liveTickets`?
- Which commands have no UI path?
- Which UI action points to a missing runtime entry?
- Which policy protects the backend entry behind a button?

This is why frontend checks appear in `forge dev --once --json`, `forge inspect frontend --json`, `forge inspect capabilities --json`, and `agentContract.json`.

## Client bridge

Templates ship a bridge file such as `web/lib/forge.ts`, `web/src/lib/forge.ts` for Vite, or `web/composables/forge.ts` for Nuxt. Import hooks or composables from there, **not** from deep paths under `_generated/`:

```tsx
import { useCommand, useQuery, useLiveQuery, ForgeProvider } from "../lib/forge";
```

After adding commands, queries, or routes:

```bash
forge generate
forge inspect client --json
```

## React hooks

| Hook | Calls | Use for |
|------|-------|---------|
| `useCommand(name)` | `POST /commands/:name` | Writes, form submits |
| `useQuery(name, args)` | `POST /queries/:name` | One-shot reads |
| `useLiveQuery(name, args)` | `GET /live/:name` (SSE) | Live-updating lists |

Example:

```tsx
"use client";

import { useCommand, useLiveQuery } from "../lib/forge";

export function TicketList() {
  const createTicket = useCommand("createTicket");
  const tickets = useLiveQuery("liveTickets", {});

  return (
    <div>
      <button onClick={() => createTicket.mutate({ title: "New ticket" })}>
        Create
      </button>
      <ul>
        {(tickets.data ?? []).map((ticket) => (
          <li key={ticket.id}>{ticket.title}</li>
        ))}
      </ul>
    </div>
  );
}
```

## Nuxt and Vue composables

Nuxt apps use `web/plugins/forge.client.ts` and `web/plugins/forge.server.ts` to install the Forge Vue plugin from runtime config in browser and SSR contexts. Components import generated composables from `web/composables/forge.ts` or domain composables such as `web/composables/useNotes.ts`:

```vue
<script setup lang="ts">
import { api, useForgeCommand, useForgeLiveQuery } from "../composables/forge";

const tickets = useForgeLiveQuery(api.liveQueries.liveTickets, {});
const createTicket = useForgeCommand(api.commands.createTicket);
</script>
```

The Nuxt template stores the runtime URL in `runtimeConfig.public.forgeUrl`, which can be overridden with `NUXT_PUBLIC_FORGE_URL`.
It also includes a minimal Nitro route under `web/server/api/forge-health.get.ts` to show server-side runtime-config access without bypassing generated Forge bindings in components.

## ForgeProvider and dev auth

Mount `ForgeProvider` once in the app layout. Local development typically uses `devAuth`:

```tsx
import { ForgeProvider } from "../lib/forge";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ForgeProvider
      apiUrl={process.env.NEXT_PUBLIC_FORGE_URL ?? "http://127.0.0.1:3765"}
      devAuth={{
        userId: "dev-user",
        tenantId: "00000000-0000-0000-0000-000000000001",
        role: "owner",
      }}
    >
      {children}
    </ForgeProvider>
  );
}
```

Production uses JWT or OIDC — see [Security and Data](security-and-data.md).

## Anti-patterns

Avoid raw runtime fetches in components:

```tsx
// ❌ bypasses generated client, capability map, and auth helpers
fetch("/commands/createTicket", { method: "POST", body: JSON.stringify({}) });
```

Forge flags many raw fetches in `forge dev --once --json` and `forge inspect frontend --json`.

## Capability map

The **capability map** connects frontend components to backend runtime entries, tables, and policies:

```bash
forge inspect capabilities --json
forge inspect frontend --json
```

It answers:

- Which component calls which command/query/liveQuery?
- Are policy names wired correctly?
- Are there orphan UI actions with no backend entry?

Use `forge do connect-ui --json` when wiring is broken. See [Agent Workflow](agent-workflow.md).

## LiveQuery

LiveQueries are **read-only**, tenant-scoped subscriptions backed by a **durable invalidation log** in production.

```text
1. UI subscribes to liveTickets (SSE)
2. Server sends initial snapshot from DB
3. Command writes a row -> invalidation recorded in _forge_live_invalidations
4. SSE wakes up and pushes a new snapshot to the UI
5. Client may resume with Last-Event-ID or ?lastRevision=
```

Rules:

- Polling and Postgres NOTIFY are **wakeups**, not the source of truth.
- Invalidations are durable rows in `_forge_live_invalidations`.
- Clients may resume with `Last-Event-ID` or `?lastRevision=`.

Debug stale subscriptions:

```bash
forge live status --json
forge live invalidations list --json
forge live debug <subscriptionId> --json
```

See [Troubleshooting — LiveQuery](troubleshooting.md#livequery-stale-or-not-updating).

## Scaffold frontend

When an app has no `web/` directory yet:

```bash
forge make ui --framework vite --dry-run --json
forge make ui --framework vite --yes
forge make ui --framework nuxt --dry-run --json
forge make ui --framework nuxt --yes
```

For AI chat UI backed by dev agent endpoints:

```bash
forge make ai-chat support --dry-run --json
forge make ai-chat support --yes
```

See [Authoring](authoring.md) and [AI](ai.md).

## Local dev loop

```bash
forge dev
forge dev --once --json
```

When `web/` exists, `forge dev` starts **both** the API runtime and the web dev server and prints URLs for each.

Useful flags:

| Flag | Effect |
|------|--------|
| `--api-only` | Backend only |
| `--web-only` | Frontend only |
| `--no-watch` | Disable file watching |
| `--no-worker` | Disable outbox worker |

## Inspection checklist

Before merging frontend changes:

```bash
forge generate
forge inspect frontend --json
forge inspect capabilities --json
forge dev --once --json
forge check --json
```

## Related pages

- [Runtime Model](runtime-model.md) — why commands cannot call network/AI
- [Frontend Integration Guide](frontend-integration-guide.md) — provider, hooks, bridge, capability map
- [Agent Workflow](agent-workflow.md) — `forge do connect-ui`
- [Templates](templates.md) — minimal-web vs b2b-support-web
- [Security and Data](security-and-data.md) — auth modes and policies
