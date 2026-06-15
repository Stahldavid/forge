# forgeos

## 0.1.0-alpha.1

Republish alpha with the dependency/API oracle improvements:

- Added dependency API inspection commands for agents:
  `forge deps api`, `forge deps trace`, and `forge deps runtime-compat`.
- Added dependency API summaries to `agentContract.json`.
- Added package resolution traces, runtime compatibility metadata, and
  runtime/type mismatch diagnostics to `packageGraph`.
- Reduced package graph warning noise for `package.json` metadata exports,
  declaration-file subpaths, and pattern exports.

## 0.1.0-alpha.0

Initial alpha packaging baseline for ForgeOS.

This release line is intended to validate npm installation, the `forge` CLI binary,
template creation, generated contracts, and the agent-native local development loop.

Added ReadTheDocs-ready public documentation, generator/package version alignment
checks, and a broad generated-app field-test harness for release hardening.
