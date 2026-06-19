# Playbook: Fix Policy Denied

1. Run `forge repair diagnose --from-last-test-run --json`.
2. Run `forge policy simulate <policy> --role <role>`.
3. Prefer policy changes through `forge make policy`.
4. Run `forge verify --strict` after changing access rules.
