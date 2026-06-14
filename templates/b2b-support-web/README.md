# ForgeOS B2B Support Web Template

## Quick Start

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run verify
__PACKAGE_MANAGER__ run dev
```

Open:

- API: http://127.0.0.1:3765/health
- Web: http://127.0.0.1:3000

## What This Template Demonstrates

- DataGraph schema
- policy-gated commands and queries
- tenant isolation
- liveQuery reactivity
- outbox actions
- lightweight workflows
- AI workflow step in mock mode
- telemetry trace IDs
- React hooks

## Useful Commands

```bash
forge inspect app --json
forge inspect data --json
forge inspect policies --json
forge inspect client --json
forge verify --strict
```
