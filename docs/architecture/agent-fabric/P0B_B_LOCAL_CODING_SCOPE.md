# P0b-B — local coding task scope and gate (proposal)

Status: candidate planning input. This document neither changes the accepted P0a/P0b-A
protocol nor accepts a P0b-B implementation. It refines the local pilot in
[`CODING_AGENT_DELIVERY_PLAN.md`](./CODING_AGENT_DELIVERY_PLAN.md). Runtime changes require
separate exact-head review, conformance evidence, and an adoption record.

## 1. Purpose and boundary

P0b-B is a single-owner, single-host pilot led by `forge fabric` CLI commands. A
local Forge approval window displays the exact proposed task before the owner starts
an attempt with Ollama. MCP follows as an adapter over the same task service, so
Codex, Claude Code, Cursor, and other clients can use one contract. None is an
authority source. Codex model execution is excluded from the default path, as are
hosted API keys and automatic publication.

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

## 3. CLI, approval window, and MCP adapter

The CLI is the first client of one local task service. Expansion is staged:

1. `forge fabric propose`, `status`, and `evidence` use bounded, redacted data. A
   proposal is untrusted and confers no run permission. Before durable storage, status
   reports `unavailable` honestly.
2. Forge opens a local approval window showing repository, base commit, paths,
   effects, model, budgets, verification commands, and a digest of the immutable
   revision. The owner can approve or reject that exact revision. A CLI flag, model
   output, or MCP request cannot substitute for the visible decision. An approval
   applies once and expires; a changed revision requires a new decision.
3. The bounded Ollama worker receives task data but has no shell, browser, approval
   endpoint, or general tools. `forge mcp serve` later maps read-only tools to the
   same task service. Any MCP proposal/request surface requires its own compatibility
   review and cannot add a second authorization path.

The browser window is a cooperative user experience, not proof against a hostile
agent with unrestricted shell or UI automation in the same OS account. This pilot
therefore only accepts a bounded text-only worker and a trusted local repository.
Stronger owner presence, such as Windows Hello/passkey, and isolation of an external
coding client require a later security slice. A general `fabric_authorize` tool must
not be added to MCP in this pilot.

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
| B-P02 | Versioned task/effect/CLI contract with unknown, stale, duplicate, and malformed request semantics; MCP is an adapter. |
| B-P03 | The approval window binds the displayed immutable revision and is inaccessible to the bounded Ollama worker; unrestricted same-account agents remain outside this pilot's security claim. |
| B-P04 | PGlite transaction and replay design proves no acknowledged lost append, no partial event batch, and no model invocation during replay. |
| B-P05 | Exact repo/base/path/model/budget bindings and separate effect authorization, with a trusted-repo limitation. |
| B-P06 | Explicit failure and uncertainty behavior for crash, cancellation, stale fencing, storage corruption, ambiguous patch result, and failed verification. |
| B-P07 | No Codex model turn, hosted provider key, arbitrary network endpoint, merge, publish, or deploy in default acceptance. |
| B-A01 | CLI proposal/status/evidence and approval-window paths are exercised before a separate two-client MCP compatibility gate. |
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
