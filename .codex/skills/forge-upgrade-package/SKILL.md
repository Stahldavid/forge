---
name: forge-upgrade-package
description: Use when upgrading a package in a ForgeOS app.
---

# Use when upgrading a package in a ForgeOS app.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Run `forge deps upgrade-plan <package> --to latest --json`.
Review runtime, secret, and API risks before applying.
Run impacted tests and `forge verify --changed`; use strict verification for release or an explicitly comprehensive delivery gate.
