# ForgeOS Security Invariants

This file defines the security guarantees ForgeOS intends to preserve across compiler, runtime, generated artifacts, CLI, release, and agent workflows.

Each invariant has a threat, guarantee, enforcement points, tests, CI coverage, and evidence artifact. An invariant is not considered proved unless the listed automated checks run successfully and produce reviewable evidence.

## Assurance Levels

| Level | Meaning |
|-------|---------|
| Design | The architecture and docs define the guarantee. |
| Checked | Static or generated checks enforce the guarantee. |
| Tested | Automated positive and negative tests exercise the guarantee. |
| Proved | CI runs the tests and emits evidence artifacts. |
| Reviewed | External or independent review validated the guarantee. |

## Core Invariants

| ID | Invariant | Current level |
|----|-----------|---------------|
| INV-001 | Dev headers must not be accepted for production auth. | Checked |
| INV-002 | A tenant must never read, list, update, or delete another tenant's data through app runtime APIs. | Design |
| INV-003 | Postgres RLS must block cross-tenant access even when app handler code is wrong. | Design |
| INV-004 | Commands must not access network packages, secrets, filesystem, AI, or direct `process.env`. | Tested |
| INV-005 | Queries and liveQueries must be read-only and side-effect free. | Tested |
| INV-006 | Agent tools must inherit auth, tenant, policy, telemetry, and runtime boundaries. | Tested |
| INV-007 | Write, external, and destructive agent tools must require approval unless explicitly allowlisted by policy. | Tested |
| INV-008 | Secret values must never appear in generated artifacts, agent contracts, telemetry, traces, logs, or reports. | Tested |
| INV-009 | Webhooks and integration callbacks must reject invalid signatures, replayed events, and tampered payloads. | Design |
| INV-010 | Published packages must be traceable through lockfiles, provenance, CI gates, and release evidence. | Checked |

## INV-001: Dev Headers Must Not Work In Production

Threat:

An attacker sends `x-forge-user-id`, `x-forge-tenant-id`, or `x-forge-role` headers to impersonate users in a production deployment.

Guarantee:

Production deployments use `jwt` or `oidc`; `dev-headers` is local-only.

Enforcement points:

- auth config registry;
- `forge auth check --json`;
- dev server auth mode handling;
- production deployment docs and self-host checks.

Static check:

- `forge auth check --json`

Runtime/integration test:

- planned: `tests/security/auth/production-dev-headers-denied.test.ts`

Negative/adversarial test:

- planned: production-mode request with `x-forge-role: owner` must be rejected or ignored.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/auth-check.json`

## INV-002: App Runtime Tenant Isolation

Threat:

Tenant B tries to access tenant A data by guessing IDs, passing `tenantId` in args, or using generated agent tools.

Guarantee:

Tenant authority comes from `ctx.auth`, policies, and generated tenant metadata, not caller-provided args.

Enforcement points:

- policy registry;
- tenant scope metadata;
- runtime auth context;
- generated agent contract and tool registry.

Static check:

- `forge inspect data --json`
- `forge inspect policies --json`
- `forge inspect agent-tools --json`

Runtime/integration test:

- planned: `tests/security/tenant-isolation/*`

Negative/adversarial test:

- planned: cross-tenant `get`, `list`, `update`, `delete`, liveQuery, and agent auto-tool calls.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/tenant-isolation.json`

## INV-003: Postgres RLS Blocks Handler Bugs

Threat:

A handler forgets tenant filtering or uses a bugged query, but database access still returns cross-tenant rows.

Guarantee:

Postgres RLS denies cross-tenant access independently of handler code.

Enforcement points:

- generated `rlsPolicies.sql`;
- `tenantScope.json`;
- DB session context;
- Postgres roles without `BYPASSRLS`.

Static check:

- `forge rls check --json`

Runtime/integration test:

- planned: `tests/security/rls/postgres-cross-tenant.test.ts`

Negative/adversarial test:

- planned: intentionally vulnerable query against Postgres with `FORCE ROW LEVEL SECURITY`.

CI job:

- `.github/workflows/security-assurance.yml` with Postgres service.

Evidence artifact:

- `security/evidence/latest/rls-postgres.json`

## INV-004: Command Runtime Boundaries

Threat:

A command performs network, secret, filesystem, AI, or direct environment access inside a transaction.

Guarantee:

Commands stay deterministic and transactional; side effects move to actions/workflows after commit.

Enforcement points:

- import guards;
- AI usage guard;
- secret context runtime guard;
- direct `process.env` guard;
- runtime matrix.

Static check:

- `forge check --json`

Runtime/integration test:

- `tests/security/runtime-boundaries.test.ts`

Negative/adversarial test:

- bad command with `ctx.ai`, `ctx.agent.run`, forbidden package import, secret access, or direct `process.env`.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/runtime-boundaries.json`

## INV-005: Query And LiveQuery Read-Only Boundaries

Threat:

A query or liveQuery mutates data, emits events, accesses secrets, or calls AI.

Guarantee:

Queries and liveQueries are read-only and side-effect free.

Enforcement points:

- query usage guard;
- read-only DB client;
- liveQuery runner forbidden context;
- generated runtime rules.

Static check:

- `forge check --json`

Runtime/integration test:

- `tests/security/runtime-boundaries.test.ts`

Negative/adversarial test:

- bad query with `ctx.db.insert`, `ctx.emit`, `ctx.secrets`, or `ctx.ai`.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/runtime-boundaries.json`

## INV-006: Agent Tools Inherit Forge Boundaries

Threat:

An AI agent bypasses policies, tenant context, telemetry, or runtime boundaries by calling generated tools directly.

Guarantee:

Agent auto-tools call Forge runtime endpoints and carry the same auth, tenant, policy, telemetry, and approval metadata as app calls.

Enforcement points:

- `agentTools.json`;
- `agentContract.json`;
- dev server auto-tool runtime adapter;
- AI runtime context.

Static check:

- `forge inspect agent-tools --json`

Runtime/integration test:

- `tests/security/agent-tools.test.ts`

Negative/adversarial test:

- command auto-tool must be `risk: "write"` and `needsApproval: true`; query/liveQuery auto-tools must be read-only.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/agent-tools.json`

## INV-007: Dangerous Agent Tools Require Approval

Threat:

A model calls a destructive, external, or write tool without human or policy approval.

Guarantee:

Dangerous tools expose approval requirements and runtime callers can block execution before tool invocation.

Enforcement points:

- AI registry parser;
- `agentTools.json`;
- generated docs;
- runtime AI tool metadata.

Static check:

- `forge ai tools --json`

Runtime/integration test:

- `tests/security/agent-tools.test.ts`

Negative/adversarial test:

- destructive and external tools must retain `needsApproval: true` or `dynamic`.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/agent-tools.json`

## INV-008: No Secret Leakage

Threat:

Secrets leak through generated files, telemetry, traces, logs, agent contracts, stack traces, or reports.

Guarantee:

ForgeOS stores and emits secret names, never secret values; runtime payloads are scrubbed.

Enforcement points:

- secret registry;
- secret scanner;
- telemetry scrubber;
- generated artifact leak scan;
- `process.env` guard.

Static check:

- `forge secrets check --json`

Runtime/integration test:

- `tests/security/secret-redaction.test.ts`

Negative/adversarial test:

- canary secret values are injected into payloads and must be redacted or absent.

CI job:

- `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/secret-redaction.json`

## INV-009: Webhook Authenticity

Threat:

An attacker sends forged, replayed, or tampered integration callbacks.

Guarantee:

Webhook handlers verify signatures, timestamps, replay windows, and payload integrity before side effects.

Enforcement points:

- planned integration recipes;
- planned webhook helpers;
- action/workflow side-effect boundary.

Static check:

- planned: `forge security prove --webhooks --json`

Runtime/integration test:

- planned: `tests/security/webhooks/*`

Negative/adversarial test:

- invalid signature, replayed timestamp, tampered body.

CI job:

- planned `.github/workflows/security-assurance.yml`

Evidence artifact:

- `security/evidence/latest/webhooks.json`

## INV-010: Release Supply Chain Traceability

Threat:

Published artifacts are tampered with, built from an unknown commit, or shipped with unchecked dependency risk.

Guarantee:

Releases are traceable to source, CI, package metadata, provenance, and release evidence.

Enforcement points:

- npm Trusted Publishing;
- release scripts;
- GitHub Actions;
- package smoke tests;
- field test reports.

Static check:

- `npm run release:smoke`

Runtime/integration test:

- `npm run field:test -- --runtime-probes`

Negative/adversarial test:

- planned: release gate fails on unpublished/unpushed commit, missing provenance, or critical vulnerability.

CI job:

- `.github/workflows/publish.yml`
- `.github/workflows/field-tests.yml`

Evidence artifact:

- `security/evidence/latest/release-security.json`

## Evidence Model

Evidence is generated, not manually edited.

Recommended layout:

```txt
security/evidence/latest/
  forge-check.json
  auth-check.json
  secrets-check.json
  rls-check.json
  verify-strict.json
  runtime-boundaries.json
  secret-redaction.json
  agent-tools.json
  field-report.json
```

Local evidence directories should not include secret values, `.env` contents, raw prompts, database row data, or large telemetry payloads.
