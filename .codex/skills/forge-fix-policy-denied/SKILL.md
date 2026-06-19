---
name: forge-fix-policy-denied
description: Use when ForgeOS reports a policy or auth denial.
---

# Use when ForgeOS reports a policy or auth denial.

Run `forge repair diagnose --from-last-test-run --json` and `forge policy simulate <policy> --role <role>`.
Prefer changing policies through `forge make policy`.
