---
name: forge-upgrade-package
description: Use when upgrading a package in a ForgeOS app.
---

# Use when upgrading a package in a ForgeOS app.

Run `forge deps upgrade-plan <package> --to latest --json`.
Review runtime, secret, and API risks before applying.
Run impacted tests and `forge verify --strict`.
