# Playbook: Fix FORGE_GUARD_VIOLATION

1. Run `forge repair diagnose --from-last-test-run --json`.
2. If a network package is reachable from command/query/liveQuery, prefer `forge refactor extract-action <command> --package <package> --event <event>`.
3. Run `forge generate`, `forge check`, and `forge verify --changed`.
4. Finish with `forge verify --strict`.
