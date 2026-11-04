---
name: forge-debug-trace
description: Use when debugging a ForgeOS trace or failing runtime operation.
---

# Use when debugging a ForgeOS trace or failing runtime operation.

Resolve the `forge` examples through the applicable AGENTS.md entrypoint: use `node bin/forge.mjs` in the framework checkout and the installed CLI for generated apps.

Run `forge telemetry inspect <traceId>`.
Then run `forge repair diagnose --trace <traceId> --json`.
Prefer targeted checks before full verification.
