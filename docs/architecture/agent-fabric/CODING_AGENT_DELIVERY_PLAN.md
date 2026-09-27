# Agent Fabric for coding agents — ordered delivery plan

Status: proposed delivery plan. This record does not adopt a new runtime capability or
change the S1.0B1/S1.1 protocol. Each runtime slice needs its own reviewed scope,
implementation, evidence, and adoption record. The P0a kernel and P0b-A bounded model
adapter are the current accepted starting point.

## Intended outcome and cost boundary

The first usable target is a **single-owner local pilot**. The `forge fabric` CLI can
propose and inspect a task, while a local Forge window shows its exact scope for owner
approval. Forge can then run a coding task in
an isolated checkout using a locally installed Ollama model. The owner can inspect the
diff, checks, evidence, and uncertainty, and decide whether to accept the result. Forge
does not merge, publish, deploy, or spend a hosted model credit in this pilot.

Codex is an optional **client**, not the default execution provider. No automated
`codex exec`, SDK turn, app-server turn, or paid provider call is part of the acceptance
run. A read-only app-server handshake is permitted for compatibility diagnostics. A
later Codex worker adapter must be opt-in with an explicit cost budget; it is not a gate
for the keyless pilot. The local Ollama worker is subject to real time, token, disk, and
memory limits, even though it needs no API key.

The two user journeys are intentionally ordered:

1. An owner or cooperating coding agent uses the Forge CLI to propose and inspect a
   task. The owner sees the exact scope in a local approval window.
2. Forge supervises one bounded Ollama coding attempt. MCP then exposes the same
   task/status/evidence service to Codex and another compatible client; existing
   Agent Memory tools remain available.

## Delivery sequence

| Step | Deliverable | Acceptance evidence | Depends on |
| --- | --- | --- | --- |
| 0. Release integrity | Complete P0b-A release note and validate the release candidate at its exact head. Leave PR #10 open and do not publish. | CI/security/package smoke bound to the candidate SHA; npm dist-tag readback; release workflow did not publish. | Current accepted P0b-A. |
| 1. Contract and threat model | Versioned local task contract, owner identity, root/repository/branch allowlist, permitted reads and effects, budgets, cancellation, evidence states, and restart semantics. Classify any changes to frozen decisions. | Reviewable scope/gate with positive and adversarial vectors, including malformed and cross-repository requests. | 0. |
| 2. CLI observation | Add `forge fabric` proposal/status/evidence commands with bounded output and redaction. Keep Agent Memory distinct from authoritative control state. | CLI fixtures cover valid, malformed, stale, and unknown tasks; restart does not invent state. No command can start work yet. | 1. |
| 3. Durable local control | Transactional local journal, trusted owner ingress, compare-and-swap append, verified replay, and recovery classification. Adapt the synchronous Conductor boundary explicitly instead of placing asynchronous storage behind it implicitly. | Kill/restart, corruption, duplicate request, concurrent append, lost response, and stale fencing tests; replay never calls a model; every acknowledged transition survives restart. | 1; can proceed alongside 2. |
| 4. Local approval window | CLI proposal stays untrusted. A local Forge window displays and approves an exact revision, effect set, and budget before start; cancellation and retries use version and idempotency checks. No CLI or MCP `--approve` shortcut exists. | Rejected, changed, expired, replayed, path-escape, and oversized requests cannot start work; approval is one-use and the bounded Ollama worker cannot invoke it. | 2, 3. |
| 5. Isolated local worker | Materialize a Git worktree from a pinned commit in a trusted repository; use a fixed Ollama endpoint/model; bound wall time, tokens, context, paths, and output. Treat the patch as data and run only owner-approved verification commands. | A real keyless task yields a diff and evidence; cancellation and ambiguous outcomes stay nonterminal; patch application is confined to the isolated checkout. | 3, 4. |
| 6. Assurance and owner acceptance | Capture exact base/head, diff digest, commands, exit codes, focused tests, independent review provenance, and an owner decision. Separate observed test results from task acceptance. | A bad patch is rejected; a good patch can be accepted without implicit merge/release; all statuses retain `blocked`/`inconclusive` where applicable. | 5. |
| 7. Portable agent integration | Add a thin MCP adapter over the CLI's task service and publish setup for Codex and another compatible client. Add an optional external-worker adapter only after its permission, cost, and cancellation behavior is specified. | Real two-client read and proposal interoperability evidence, with a versioned protocol fixture; no paid Codex turn or MCP approval tool in the default suite. | 2, 4, 6. |
| 8. Consequential effects and sandbox | Define the effect broker's request, resolution, authorization, materialization, receipt, readback, and reconciliation chain. Isolate untrusted commands in a governed container/VM before broadening beyond trusted repositories. | Crash at every boundary preserves an honest effect state; unknown receipts never become success; sandbox escape and out-of-scope effect probes are rejected. | 3, 6. |
| 9. Forge Intelligence and memory | Add source-grounded repository/context resolution, assessment/provenance, invalidation, and governed persistent memory. Memory informs proposals but never grants authority. | Changed source invalidates stale context; untrusted instructions cannot promote themselves; private content retention and deletion are tested. | 3, 6. |
| 10. Adaptive harness and multiple agents | Compile bounded agent/harness profiles, delegate through attenuated child grants, schedule leased workers, account for resources, and coordinate joins/cancellation/recovery. | Two local workers complete a bounded workflow; stale lease, over-budget child, and failed join cannot create an authoritative outcome. | 8, 9. |
| 11. Evolution Registry | Record improvement candidates, run fixed evaluations, then govern canary, promotion, rollback, and revocation of extensions. No self-promotion from model output. | A failed eval blocks promotion; revoked extension cannot run; old attempts remain traceable to the exact version used. | 6, 10. |
| 12. Production expansion | For a multiuser deployment: authenticated principals, tenant isolation, durable shared store/outbox, worker fencing across hosts, observability, quotas, retention, backup/restore, and incident operations. | Separate threat review, migration/rollback proof, concurrent-host recovery, tenant-boundary tests, staging smoke, and explicit production acceptance. | 8–11 and a specified target environment. |

Steps 2 and 3 may be built in parallel after the contract is adopted. The dependency
barrier before any MCP write is deliberate: a mutating MCP surface would otherwise
create a second, weak authority path around the Conductor. The local approval window
is a cooperative pilot interaction; it is not a security boundary against an external
agent with unrestricted shell and UI control in the same OS account. Step 5 must not claim
exactly-once model execution after a crash; an ambiguous attempt is recorded as
uncertain and reconciled or explicitly reauthorized.

## Minimum local task contract for step 1

Each task has a stable `taskId`, `rootExecutionId`, owner identity, exact repository
identity and base commit, goal and acceptance criteria, source/path allowlist, effect
classes, model destination, time/token/attempt budgets, and expiry. Each attempt binds
to an immutable task revision and an isolated checkout. The client may submit a
proposal; only trusted owner ingress can issue an authorization. Model responses,
repository files, MCP client claims, and Agent Memory events are untrusted input.

The control record stores digests and bounded metadata. Raw prompts, model output,
secrets, and command output belong in separately governed artifacts with explicit
retention and redaction rules. `succeeded` means an authorized attempt completed;
task acceptance remains a separate owner decision. `unknown` or stale outcomes cannot
be silently promoted to success.

## Required architecture decisions before implementation

1. Use the existing PGlite adapter for the local pilot under one process owner. Keep
   the synchronous Conductor as an ephemeral projection inside a serialized command
   boundary: load and replay the trusted prefix, run a transition in memory, persist
   its complete event batch with a sequence compare-and-swap in one database
   transaction, and acknowledge only after commit. On failed commit, discard that
   projection. Dispatch external work only after the permit batch commits. Prove the
   boundary with crash and concurrent-writer tests before considering PostgreSQL or
   multi-host operation.
2. Bind the local approval window to the immutable revision and keep it outside the
   bounded Ollama worker. Loopback transport, a client-supplied owner string, or a
   model-callable CLI alone is insufficient authorization. The cooperative pilot
   does not claim protection against an unrestricted same-account agent; stronger
   owner presence and client isolation are later security gates.
3. Define effect classes for checkout creation, file edits, commands, Git operations,
   and external network requests. The local worker starts with the narrowest useful
   classes; publish/deploy/merge are excluded.
4. Bind model/provider resolution to trusted configuration, not task text; preserve
   P0b-A destination and budget semantics when extending to tools.
5. Define the evidence store, artifact retention, integrity check, and recovery behavior.
   A hash chain alone does not authenticate an arbitrary storage prefix.
6. Review the existing documentation that calls `forge mcp serve` read/context-only.
   Mutating tools require a separately adopted scope and an explicit compatibility
   update, not an undocumented expansion of that alpha contract.

## End-to-end local acceptance scenario

From a clean checkout, an owner configures the Forge CLI and a local Ollama model without
an API key. A CLI client proposes a small coding task and receives a stable task ID.
The owner approves the exact scope and budget in a Forge window. Forge creates
an isolated checkout, runs one bounded local attempt, records the resulting diff and
checks, and exposes the evidence over MCP. After forcibly stopping and restarting Forge,
the same task and evidence are visible and no model call is repeated. The owner either
rejects the diff or explicitly accepts it. An unrelated repository, expired grant,
stale attempt, or forged proposal cannot authorize work through the bounded worker.
After the CLI pilot is accepted, two MCP clients read the same state and propose through
the same service. Every run records the exact source commit,
model identifier, tool versions, test result, and remaining limits.

Passing this scenario establishes only the local pilot. Steps 8–12 finish the broader
Agent Fabric direction in the frozen architecture; each requires a separate scope and
acceptance record. General coding quality and production readiness remain unproven
until their own evaluations and operational gates pass.
