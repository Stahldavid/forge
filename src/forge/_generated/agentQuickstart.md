// @forge-generated generator=0.1.0-alpha.18 input=d037a38973574e99c5c6fe2374b25cddbe8b19b9f673974d1f9f4858c3f8b03b content=8a11ed1c878594b797fd231584b012b0b7f1add75c6fdc4e6720ea21d6bfd61b
# Agent Quickstart

Run:

```bash
forge agent onboard --target codex --json
forge status --json
forge changed --json
forge handoff --json
forge do inspect --json
forge do fix --json
forge do verify --json
forge dev --once --json
forge dev
forge agent print-context --json
forge inspect frontend --json
forge inspect capabilities --json
forge inspect agent-tools --json
forge inspect all --json
forge check --json
forge ai trace <traceId> --json
```

Never edit:

```txt
src/forge/_generated/**
forge.lock
```

If generated files are ignored by git, recreate them with `forge generate`.

Always finish with:

```bash
forge generate
forge verify --strict
```
