# Playbook: Upgrade Package

1. Run `forge deps upgrade-plan <package> --to latest --json`.
2. Review runtime context, secret, and API risk.
3. Apply only after reviewing the plan.
4. Run impacted tests and `forge verify --strict`.
