# Playbook: Add Resource

1. Run `forge make resource <name> --fields name:string --dry-run --json`.
2. Review planned schema, policies, commands, queries, and components.
3. Apply with `forge make resource <name> --fields ... --yes`.
4. Run `forge generate` and `forge verify --strict`.
