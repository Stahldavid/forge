# Public Proof Walkthrough

This walkthrough is for people evaluating ForgeOS from the outside.

It is not a benchmark and not a production certification. It is a reproducible proof that a ForgeOS app can expose enough structured context for an AI coding agent to inspect, change, and verify a full-stack app safely.

## 1. Install and generate

```bash
npm install
npm run generate
```

Expected result:

- dependencies install;
- `src/forge/_generated/**` is recreated;
- `forge.lock` is recreated locally;
- source files remain the canonical edit surface.

## 2. Inspect the app contract

```bash
npm run proof:inspect
```

This runs:

```bash
forge do inspect --json
```

Look for:

- commands: `createTicket`, `closeTicket`, `manageBilling`;
- queries/liveQueries: `listTickets`, `getTicket`, `liveTickets`;
- action/workflow entries for `ticket.created`;
- policy and tenant hints;
- recommended next commands.

## 3. Start a deterministic dev snapshot

```bash
npm run proof:dev
```

This runs:

```bash
forge dev --once --json
```

Look for:

- generated drift status;
- API runtime health;
- database adapter health;
- worker status;
- frontend URL and route discovery;
- diagnostics and fix hints.

## 4. Verify frontend/backend wiring

```bash
npm run proof:capabilities
```

This runs:

```bash
forge inspect capabilities --json
```

Look for bindings between:

- `CreateTicketForm` and `createTicket`;
- `TicketList` and `liveTickets`;
- `PolicyDeniedDemo` and `manageBilling`;
- `/tickets` and the runtime entries it uses.

## 5. Exercise the browser app

```bash
npm run dev
```

Open the web URL printed by the command.

Manual checks:

1. Create a ticket.
2. Confirm it appears in the live list.
3. Confirm the triage copy is present or updates after the worker processes events.
4. Click `Try billing.manage`.
5. Confirm the UI shows a policy denial trace instead of bypassing authorization.

## 6. Ask an agent to make a change

Use this task:

```txt
Add a status filter to the ticket queue.

Use the ForgeOS agent workflow. Inspect the contract first, edit source files only,
regenerate, check, inspect capabilities, and finish with verify --standard.
```

A good agent should run:

```bash
npm run forge -- do inspect --json
npm run forge -- dev --once --json
npm run forge -- inspect capabilities --json
```

Then edit source files under:

```txt
src/queries/**
web/**
```

It should not edit:

```txt
src/forge/_generated/**
forge.lock
```

## 7. Verify handoff

```bash
npm run proof:verify
```

This runs:

```bash
forge verify --standard
```

Use `verify --strict` for release-grade validation, but `--standard` is the normal agent development gate.

## What this proves

This app demonstrates the ForgeOS development contract:

```txt
source app
  -> generated contract
  -> inspectable runtime/frontend/policy map
  -> agent-guided edits
  -> check/repair/verify loop
```

The important part is not that the app is large. The important part is that the app is legible.
