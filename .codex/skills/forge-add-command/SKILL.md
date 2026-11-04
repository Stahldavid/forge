---
name: forge-add-command
description: Use when adding or modifying a ForgeOS command.
---

# Use when adding or modifying a ForgeOS command.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Rules:
- Commands require `auth: can("...")`.
- Commands may write through `ctx.db`.
- Commands may call `ctx.emit`.
- Commands must not import network packages.
- Commands must not use `ctx.secrets` or `ctx.ai`.

Steps:
1. Inspect the existing diff and the relevant command, schema and policy context.
2. Prefer `forge make command <resource.action> --table <table> --policy <policy>`.
3. Run `forge generate`, `forge check`, and `forge verify --changed`.
4. Use `forge verify --strict` for release or an explicitly comprehensive delivery gate; do not repeat passing affected checks without new evidence.
