# Playbook: Add LiveQuery

1. Prefer `forge make livequery <name> --table <table> --policy <policy>`.
2. Keep liveQueries read-only and reactive.
3. Run `forge live status --json` when debugging subscriptions.
4. Run `forge verify --changed`.
