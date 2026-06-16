# Changelog

Release history for the `forgeos` npm package (`alpha` dist-tag).

The canonical source file in the repository is `CHANGELOG.md`.

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

- Added public [AI](ai.md) page and AST-aware `rename command` codemod docs.
- Full RTD expansion: [Agent Workflow](agent-workflow.md), [Frontend](frontend.md), [Security & Data](security-and-data.md), [Authoring](authoring.md), [Testing & Repair](testing-and-repair.md), [Self-Host](self-host.md), [Templates](templates.md), Material theme, search, and Mermaid diagrams.

## 0.1.0-alpha.2

Windows and generated-app hardening:

- Fixed Node ESM handler loading on Windows by importing generated app modules through `file://` URLs across commands, queries, liveQueries, outbox actions, workflow steps, mocks, and telemetry adapters.
- Fixed `forge dev` SSE streaming on the Node HTTP fallback so liveQuery snapshots are flushed immediately instead of buffering forever.
- Hardened generated app scaffolding and web dev spawning on Windows.
- Updated the B2B support template to route frontend imports through `web/lib/forge.ts` and use safer handler input validation.
- Added focused tests for Node compatibility, template scaffolding, runtime imports, and streaming responses.
- Added `create-forge-app@alpha` for `npm create forge-app@alpha`.
- Added GitHub Packages mirror workflow for scoped package publishing.

## 0.1.0-alpha.1

Republish alpha with the dependency/API oracle improvements:

- Added dependency API inspection commands for agents: `forge deps api`, `forge deps trace`, and `forge deps runtime-compat`.
- Added dependency API summaries to `agentContract.json`.
- Added package resolution traces, runtime compatibility metadata, and runtime/type mismatch diagnostics to `packageGraph`.
- Reduced package graph warning noise for `package.json` metadata exports, declaration-file subpaths, and pattern exports.

## 0.1.0-alpha.0

Initial alpha packaging baseline for ForgeOS.

This release line validates npm installation, the `forge` CLI binary, template creation, generated contracts, and the agent-native local development loop.

Added Read the Docs-ready public documentation, generator/package version alignment checks, and a broad generated-app field-test harness for release hardening.
