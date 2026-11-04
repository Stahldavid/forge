---
name: forge-fix-guard-violation
description: Use when ForgeOS reports FORGE_GUARD_VIOLATION.
---

# Use when ForgeOS reports FORGE_GUARD_VIOLATION.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Run `forge repair diagnose --from-last-test-run --json`.
If a network package is reachable from command/query/liveQuery, prefer:
`forge refactor extract-action <command> --package <package> --event <event>`.
