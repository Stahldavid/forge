# ForgeOS

ForgeOS is an agent-native application framework and compiler. It gives AI coding agents and humans a generated contract for the app they are editing: commands, queries, liveQueries, policies, data, secrets, frontend routes, runtime rules, and the commands needed to verify a change.

The current package is an alpha release:

```bash
npm install -g forgeos@alpha
forge --help
```

You can also run it without a global install:

```bash
npx forgeos@alpha --help
```

ForgeOS is useful when you want a backend/runtime that is explicit, inspectable, and safe for code agents to operate without a mandatory dashboard.

## What ForgeOS Generates

- `AGENTS.md` for agent and human workflow instructions.
- `src/forge/_generated/agentContract.json` for machine-readable project context.
- `src/forge/_generated/appMap.md` for a human architecture map.
- Runtime guards for commands, queries, liveQueries, actions, workflows, policies, packages, secrets, auth, and frontend wiring.

## Core Loop

```bash
forge dev
forge dev --once --json
forge inspect all --json
forge verify --standard
```

Use `forge dev` for the local loop and `forge dev --once --json` when an agent needs a deterministic diagnostic snapshot.

## Documentation Map

| Topic | Page |
|-------|------|
| Install packages safely | [forge add](forge-add.md) |
| Integration recipes (Stripe, PostHog, AI, …) | [Recipes](recipes.md) |
| AI runtime rules | [AI](ai.md) |
| Payment flows and webhooks | [Payments](payments.md) |
| AST-aware refactors | [Codemods](codemods.md) |
| Guard violations, verify, repair | [Troubleshooting](troubleshooting.md) |
| Agent-readable contract | [Agent Contract](agent-contract.md) |
| External app validation | [Field Testing](field-testing.md) |
