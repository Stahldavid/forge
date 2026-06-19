# Playbook: Refactor Field

1. Use `forge refactor rename field <from> <to> --plan` before manual edits.
2. Inspect the plan and public API risk.
3. Apply with `forge refactor apply <planId> --yes`.
4. Run `forge impact --changed --json` and targeted tests.
