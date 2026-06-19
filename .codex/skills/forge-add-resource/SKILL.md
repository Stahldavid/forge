---
name: forge-add-resource
description: Use when adding a ForgeOS resource.
---

# Use when adding a ForgeOS resource.

Use `forge make resource <name> --fields ... --dry-run --json` first.
Review generated table, policy, command, query, liveQuery, component, and page changes.
Apply with `--yes`, then run `forge generate` and `forge verify --strict`.
