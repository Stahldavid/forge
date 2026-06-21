# Playbook: Add Command

1. Run `forge status --json`, `forge handoff --json`, and `forge agent print-context --json`.
2. Prefer `forge make command <resource.action> --table <table> --policy <policy>`.
3. Commands may write through `ctx.db` and emit with `ctx.emit`.
4. Commands must not import network packages, use `ctx.secrets`, or call `ctx.ai`.
5. Run `forge generate`, `forge check`, and `forge verify --changed`.
6. Finish with `forge verify --strict`.
