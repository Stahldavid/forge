# ForgeOS B2B Support Web Template

## Quick Start

```bash
__PACKAGE_MANAGER__ install
__PACKAGE_MANAGER__ run generate
__PACKAGE_MANAGER__ run dev
```

`forge dev` starts the API runtime, database, worker, watcher, and web app together.

Open:

- API: http://127.0.0.1:3765/health
- Web: http://127.0.0.1:3000

For one-shot agent/CI diagnostics:

```bash
__PACKAGE_MANAGER__ run forge -- dev --once --json
__PACKAGE_MANAGER__ run forge -- inspect all --json
__PACKAGE_MANAGER__ run verify
```

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

Generated files, local runtime state, and dependencies are gitignored and hidden from editor search by default. Recreate generated files with `forge generate`.
