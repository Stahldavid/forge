# Playbook: Add Query

1. Run `forge inspect data --json` and `forge inspect policies --json`.
2. Prefer `forge make query <name> --table <table> --policy <policy>`.
3. Keep queries read-only and tenant-scoped.
4. Run `forge generate` and `forge check`.
