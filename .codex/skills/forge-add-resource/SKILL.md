---
name: forge-add-resource
description: Use when adding a ForgeOS resource.
---

# Use when adding a ForgeOS resource.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Use `forge make resource <name> --fields ... --dry-run --json` first.
Review generated table, policy, command, query, liveQuery, component, and page changes.
Apply with `--yes`, then run `forge generate`, `forge check` and affected tests. Use strict verification when the schema/policy risk or delivery gate requires it.
