# forgeos

## 0.1.0-alpha.9

### Patch Changes

- Reuse compiler classifier package signals across export classification, dropping repeated package signal scans.
- Reuse serialized graph JSON when rendering the largest generated TypeScript graph artifacts.
- Keep generated Forge artifacts aligned with the `0.1.0-alpha.9` compiler/runtime version.

## 0.1.0-alpha.8

### Patch Changes

- [`7568756`](https://github.com/Stahldavid/forge/commit/756875688873dd60d3d6cf700a7bb7c211968c69) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Publish prerelease packages through the ForgeOS alpha publisher so npm dist-tags stay aligned.

## 0.1.0-alpha.7

### Patch Changes

- [`4ace311`](https://github.com/Stahldavid/forge/commit/4ace3113e3298b5c306000870922fcfbae9c1861) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Keep npm prerelease publishing on the public alpha dist-tag.

## 0.1.0-alpha.6

### Patch Changes

- [`c30f906`](https://github.com/Stahldavid/forge/commit/c30f9069c99ac747ce143ab5fbcbf13912ed8760) Thanks [@Stahldavid](https://github.com/Stahldavid)! - Add CLI version output, align create-app help with package metadata, and add release dependency audit evidence.

## Unreleased

Release and packaging hardening:

- Added `forge --version` / `forge --version --json`.
- Updated `create-forgeos-app` help to read the wrapper package version instead of a hardcoded string and bumped the wrapper to `0.1.0-alpha.2`.
- Added dependency vulnerability evidence with an explicit waiver file and CI release gate.
- Updated generated web template dependencies to current Vite/plugin-react and Next majors.

## 0.1.0-alpha.5

Release alignment for the public alpha channel:

- Added `forge ai redteam --model-level --json` with deterministic prompt-injection, secret-exfiltration, approval-bypass, cross-tenant, and indirect tool-injection probes.
- Added `forge security prove --full --json` support for source checkouts, with graceful structural-proof fallback when packaged apps do not include ForgeOS test fixtures.
- Strengthened npm publish workflows to run `security prove --db postgres --full --json`.
- Added public registry smoke coverage for `forgeos@alpha` and `create-forgeos-app@alpha`.
- Bumped the create-app wrapper package line to `create-forgeos-app@0.1.0-alpha.1`.

## 0.1.0-alpha.4

Security assurance and release evidence hardening:

- Added value-aware telemetry redaction for known secret values in safe-looking fields, messages, details, outputs, and stack traces.
- Added webhook signature, timestamp, and replay protection helpers with Stripe/GitHub/generic HMAC coverage.
- Added HTTP tenant-isolation tests that exercise the dev server/API boundary, not only the internal runtime executor.
- Added `forge rls mutate-test --json` to kill dangerous generated RLS mutations such as missing FORCE RLS, missing policies, unconditional predicates, and `BYPASSRLS`.
- Extended `forge security prove --json` with RLS mutation proof and invariant-level evidence metadata.
- Added scripts to split security evidence by invariant and emit basic release supply-chain evidence plus CycloneDX SBOM.
- Strengthened publish/security workflows so release gates use Postgres-backed security proof, RLS mutation proof, release evidence, and SBOM generation.

## 0.1.0-alpha.3

Native Forge AI agents on top of Vercel AI SDK v6:

- Added `aiTool` and `agent` primitives with generated `agentTools.json` / `agentTools.md`.
- Added `ctx.agent.run` and `ctx.ai.runAgent` using AI SDK `ToolLoopAgent`.
- Added auto-tools for commands, queries, and liveQueries with read-only vs approval-required writes.
- Added dev agent endpoints: `POST /ai/agents/run` and `POST /ai/agents/chat`.
- Extended `forge ai` CLI with `tools`, `agents`, and `trace` subcommands.
- Added `forge inspect agent-tools` and agent tool metadata in `agentContract.json`.
- Upgraded runtime dependency to AI SDK v6 for tool calling, streaming UI, and MCP compatibility.

Documentation:

- Added public [AI](https://forgeos.readthedocs.io/en/latest/ai/) page and AST-aware `rename command` codemod docs.
- Expanded ReadTheDocs to full agent-native coverage: agent workflow (`forge do`), frontend/liveQuery, security/data, authoring, testing/repair, self-host, templates, Material theme, and changelog page.

## 0.1.0-alpha.2

Windows and generated-app hardening:

- Fixed Node ESM handler loading on Windows by importing generated app modules
  through `file://` URLs across commands, queries, liveQueries, outbox actions,
  workflow steps, mocks, and telemetry adapters.
- Fixed `forge dev` SSE streaming on the Node HTTP fallback so liveQuery
  snapshots are flushed immediately instead of buffering forever.
- Hardened generated app scaffolding and web dev spawning on Windows.
- Updated the B2B support template to route frontend imports through
  `web/lib/forge.ts` and use safer handler input validation.
- Added focused tests for Node compatibility, template scaffolding, runtime
  imports, and streaming responses.

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
