---
name: forge-add-command
description: Use when adding or modifying a ForgeOS command.
---

# Use when adding or modifying a ForgeOS command.

Rules:
- Commands require `auth: can("...")`.
- Commands may write through `ctx.db`.
- Commands may call `ctx.emit`.
- Commands must not import network packages.
- Commands must not use `ctx.secrets` or `ctx.ai`.

Steps:
1. Run `forge status --json`, `forge handoff --json`, and `forge agent print-context --json`.
2. Prefer `forge make command <resource.action> --table <table> --policy <policy>`.
3. Run `forge generate`, `forge check`, and `forge verify --changed`.
4. Finish with `forge verify --strict`.
