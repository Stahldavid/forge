---
name: forge-fix-policy-denied
description: Use when ForgeOS reports a policy or auth denial.
---

# Use when ForgeOS reports a policy or auth denial.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Run `forge repair diagnose --from-last-test-run --json` and `forge policy simulate <policy> --role <role>`.
Prefer changing policies through `forge make policy`.
