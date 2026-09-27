# P0b-B — local coding task scope and gate (proposal)

Status: candidate planning input. This document neither changes the accepted P0a/P0b-A
protocol nor accepts a P0b-B implementation. It refines the local pilot in
[`CODING_AGENT_DELIVERY_PLAN.md`](./CODING_AGENT_DELIVERY_PLAN.md). Runtime changes require
separate exact-head review, conformance evidence, and an adoption record.

## 1. Purpose and boundary

P0b-B is a single-owner, single-host pilot that makes a bounded coding task visible to
external MCP clients and executes an explicitly authorized attempt with a local Ollama
model. Codex, Claude Code, Cursor, or another MCP client may consume the same contract,
but none is an authority source. Codex model execution is excluded from the default
path, as are hosted API keys and automatic publication.

The first real task is deliberately narrow: a small edit in a **trusted repository**,
using a pinned base commit, an isolated Git worktree, bounded source context, one local
model response containing a proposed patch, and owner-approved verification commands.
The model receives no general shell, browser, network, Git push, deploy, or plugin tool.
The worktree limits where Forge applies a patch; it is **not** an OS security sandbox.
General untrusted repositories or model-selected commands require a separately reviewed
container/VM isolation slice.

P0b-B extends control around P0b-A; it does not turn an AI answer into a permit,
authoritative outcome, or owner acceptance. The P0b-A one-physical-request rule,
provider destination binding, finite bounds, and uncertainty semantics remain in force
for the model invocation used by this pilot.

## 2. External task contract

A local coding task has a versioned immutable revision containing:

| Field | Meaning and validation |
| --- | --- |
| `taskId`, `rootExecutionId`, `revision` | Server-issued identities; positive revision; never reused with different content. |
| `principalId` | Trusted local owner identity; client-supplied strings are descriptive only. |
| `repositoryId`, `repositoryRoot`, `baseCommit` | Trusted repository registration and exact Git commit. Canonical path resolution rejects traversal, symlink escape, and a different repository. |
| `goal`, `acceptanceCriteria`, `nonObjectives` | Bounded text and count; treated as untrusted task data until owner admission. |
| `sourcePaths`, `writablePaths` | Canonical repository-relative allowlists; no glob expansion after authorization; deny `.git`, secrets, generated authority artifacts, and paths outside the pinned checkout. |
| `modelTargetId` | Trusted local Ollama target/model allowlist; never a caller-selected URL or credential name. |
| `allowedEffects` | Separate classes for context read, local inference, isolated patch application, and owner-approved verification; merge, push, publish, deploy, arbitrary shell/network, and credential access absent. |
| `maximumAttempts`, `maximumWallClockMs`, `maximumOutputTokens`, `maximumContextBytes`, `maximumPatchBytes`, `expiresAt` | Finite bounds and resource accounting; all fail closed. |
| `idempotencyKey`, `expectedRevision` | Required on state-changing requests; a retry returns the prior result or conflicts. |

The exact admitted revision is canonically digested and bound to the P0a goal,
authorization, run-plan, intent, and permit lineage. The task contract must map to
existing P0a types where their semantics match; any new event family or effect type
requires its own schema, replay rule, and compatibility assessment. A separate task
projection can be rebuilt from trusted journal events; it cannot become a second
authority source.

## 3. MCP interface and trusted ingress

The existing `forge mcp serve` is read/context oriented. Expansion is staged:

1. Read-only `fabric_capabilities`, `fabric_task`, and `fabric_evidence` tools expose
   bounded, redacted status. Before durable storage, they report `unavailable` or
   `not_implemented` honestly rather than inventing task state.
2. `fabric_propose` accepts only an untrusted proposal and returns its digest/ID.
   Proposal creation confers no run permission. `fabric_request_start` and
   `fabric_request_cancel` can request a transition but must pass exact version,
   idempotency, and current owner authorization checks.
3. Owner admission occurs through a **separate trusted local interaction** that shows
   the exact repository, base, paths, effects, model, budgets, and task digest. The
   worker process and MCP model tool surface cannot reach this approval channel.
   `initialize`, stdio possession, loopback origin, a client-supplied `principalId`,
   or the ability to invoke a CLI command is not proof of owner consent.

The first implementation may expose only stage 1 while the approval mechanism is
built. A general `fabric_authorize` tool must not be added to MCP without a separate
authenticated user-presence design and adversarial tests. If the trusted local
interaction cannot be isolated from the worker/client, P0b-B stops at read-only MCP
and proposal capture; execution is not accepted.

MCP tool output excludes secrets, raw prompts/completions, hidden command arguments,
and raw private files. Unknown IDs, malformed parameters, oversized requests, and
cross-repository access return typed errors with no authoritative transition.

## 4. Durable control and recovery

Use the existing PGlite dependency for one local process owner. A serialized control
command loads a trusted journal prefix, runs a synchronous Conductor transition in an
ephemeral in-memory projection, and writes its complete event batch plus task index in
one PGlite transaction with a stream sequence compare-and-swap. Only a committed
transaction may be acknowledged. An exception or failed commit discards the projection.
External model or filesystem work starts only after the permit is committed.

The owner process is the only opener of the PGlite data directory. Separate MCP stdio
processes connect to its bounded local read/request interface; they must not each open
the database or become independent journal writers. The local interface needs an
authenticated owner channel for approval, separate from ordinary MCP client requests.
Its transport, process lifecycle, and failure behavior are part of the implementation
review, not an implicit assumption that multiple PGlite processes can share storage.

The storage contract includes stream identity, sequence, predecessor/event digests,
unique event and idempotency identities, exact serialized envelope bytes, and a
versioned schema. Startup checks storage ownership/configuration, schema version,
complete prefix, hash chain, replay semantics, and trusted definition context. Any
missing, conflicting, or corrupt prefix fails closed; a hash chain alone is not
storage-origin authentication. P0b-B claims only a trusted local storage boundary,
not production-grade journal authentication.

Crash after permit commit but before model response is **uncertain**. Recovery must not
reinvoke the model automatically. A retry requires an explicit new attempt and current
authority/budget. A stale worker or cancelled attempt cannot commit a terminal result.
Store bounded result/evidence artifacts separately from control events and reference
their digests; define retention and redaction before the first real run.

## 5. Local worker and effect boundary

For an authorized task, Forge creates a uniquely named worktree at the pinned commit
under a trusted parent directory. It confirms the resolved checkout and every source
and writable path remain within the registered repository/worktree scope. The bounded
context pack is digest-bound to the permitted sources. The fixed local Ollama target
generates a proposed patch as data. Forge rejects malformed patches, binary changes,
renames, path escapes, overlarge output, or modifications outside the writable list.

Patch application is an explicit isolated-checkout effect with an attempt-bound
receipt and post-apply readback/diff digest. No patch may be applied to the owner's
main checkout. Verification runs only exact commands chosen by the owner from a
trusted allowlist for this repository; model output cannot choose or rewrite them.
Those commands still execute repository code, so the pilot accepts only trusted
repositories. General-purpose command execution waits for a sandbox design.

An apparent model success is not a coding-task success. The result state distinguishes
model transport, patch validation/application, test observation, and owner acceptance.
Failure, blocked verification, ambiguous side effects, and cancelled/stale attempts
retain distinct states and evidence. No step performs Git push, PR merge, release, or
deployment.

## 6. Conformance and acceptance gates

| Gate | Required evidence |
| --- | --- |
| B-P01 | Exact P0a/P0b-A baseline and affected frozen rules identified; no silent supersession. |
| B-P02 | Versioned task/effect/MCP contract with unknown, stale, duplicate, and malformed request semantics. |
| B-P03 | Trusted owner ingress demonstrably inaccessible to the model/worker; MCP proposal cannot grant authority. |
| B-P04 | PGlite transaction and replay design proves no acknowledged lost append, no partial event batch, and no model invocation during replay. |
| B-P05 | Exact repo/base/path/model/budget bindings and separate effect authorization, with a trusted-repo limitation. |
| B-P06 | Explicit failure and uncertainty behavior for crash, cancellation, stale fencing, storage corruption, ambiguous patch result, and failed verification. |
| B-P07 | No Codex model turn, hosted provider key, arbitrary network endpoint, merge, publish, or deploy in default acceptance. |
| B-A01 | Protocol fixtures exercise two MCP clients or independent compatible implementations; read-only phase is verified before mutation. |
| B-A02 | Kill/restart/concurrent-write and forged-authority adversarial tests pass at the reviewed SHA. |
| B-A03 | Real local Ollama coding smoke on a trusted fixture repo produces a bounded diff and check evidence, then restart shows it without another model call. |
| B-A04 | Independent review provenance and exact-head CI/security checks are recorded; limitations remain explicit in the adoption record. |

The `B-P*` gates apply to planning adoption; `B-A*` gates apply only to a later runtime
adoption. Green CI alone does not satisfy a real model smoke or owner acceptance.

## 7. Exclusions requiring later slices

Multiuser/tenant production, remote workers, shared PostgreSQL outbox and recovery,
cross-host leases, general untrusted code execution, model-selected tools, arbitrary
child agents, autonomous merges/releases/deployments, adaptive routing, persistent
governed memory, plugin evolution, and production security/readiness remain deferred.
An optional paid Codex worker requires explicit opt-in and a separate credit budget;
the local pilot never assumes it.
