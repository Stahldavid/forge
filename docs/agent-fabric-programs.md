# Agent Fabric program workflows v2

Program workflows are an opt-in interpreter hosted by the existing authenticated local
project owner. Version-1 managed runs and accompanied task records retain their original
commands, persistence and meaning. No existing run is automatically converted.

Author a `WorkflowProgramV2` JSON value, or supply finite TypeScript source with named
imports from `forgeos/agent-fabric/workflows`. The static lowerer accepts const data,
literal arrays/objects, constructors and spreads of already lowered const data objects.
It rejects arbitrary imports, loops, closures, accessors, computed properties, array
spreads, runtime I/O and malformed syntax. Workflow source is never executed.

The shipped example is `examples/agent-fabric-v2/`. Its file-conversion reviewers are
deterministic command fixtures; configure a real distinct reviewer and project checks
for coding acceptance. See the architecture ADR for normative boundaries.

## Owner configuration and commands

The owner reads `.forge/fabric-programs.json`, with versioned `schemas`, `executors`,
`policies`, `acceptance`, `populations` and optional child `programs` registries.
Requests cannot replace that registry. Each run pins its registry and external contracts.
An author chooses registered references, not weaker review, coverage or effect authority.

Keep `forge fabric serve` alive. Every mutation uses a unique `requestId`; subsequent
mutations also require `runId` and `expectedVersion`. A repeated identical request is
idempotent; changed contents under that request ID conflict. After a version conflict,
read current status and use a new request ID for a changed decision.

| CLI action | Meaning |
| --- | --- |
| `program-validate --file request.json` | Lower and validate without dispatch |
| `program-start --file request.json` | Persist baseline, input and program before scheduling |
| `program-status --run-id ID` | Read authoritative state |
| `program-wait --file request.json` | Bounded wait using `{runId,cursor,waitMs}` |
| `program-pause`, `program-resume` | Stop new dispatch / explicitly resume settled work |
| `program-signal` | Persist an authorized event with target, generation, type and correlation |
| `program-replan` | New program with barrier/additive/fenced modes |
| `program-cancel` | Request cancellation; unobserved effects stay uncertain |
| `program-reconcile` | Record observed failure or reconcile publication |
| `program-apply` | Apply a gated candidate to local scoped files |

Use `--file request.json --json` for mutations. Start accepts `{requestId,source,input}`
or `{requestId,program,input}`. MCP exposes the same actions as
`fabric_program_*`, using `{request: BODY}` for mutations and `{runId}` for status.
Both transports use the same owner, state store and capability boundaries.
The shared authenticated HTTP owner limits each request body to 40 KiB. Keep source and
input below that transport bound; the offline lowerer's separate source cap is 256 KiB.

## Operators and contracts

`value`, `agent`, `command`, `map`, `branch`, `loop`, `repair`, `compose`, `gate`,
`subworkflow` and `waitEvent` are finite primitives. Explicit output references infer
dependencies; parent/body cycles are rejected before dispatch. Branches mark the other
arm skipped. Child programs inherit policy/acceptance and global attempt/deadline limits.
Loops require bounded rounds and a progress/termination decision. Each materialized
operation has a stable invocation ID, generation and input/semantic digests.

Schemas use a bounded JSON Schema subset: types, enum/const, properties, required,
additionalProperties, items, array/string/numeric bounds and anyOf. Unsupported keywords
are rejected. Conservative static inference checks known field, child-input, branch-merge
and result types. Unknown shapes still require runtime validation. A completed process
does not imply a valid output or approval: review payloads distinguish approved,
changes_requested and inconclusive from operational failure.

`repair@v1` is a built-in deterministic recipe. `implement-first` edits before assessment;
`assess-first` can approve with zero edits. Every assessment reviews/checks the same
candidate, with a distinct readonly reviewer and registered command checks. Candidate,
feedback, phase, implementation/assessment/infrastructure counters and measured progress
are checkpointed. Resume cannot replenish exhausted budgets. Nonaccepted recipes keep
diagnostic output and stop their consumers; later values cannot mask rejection.

`map` requires finite unique NFC keys, bounded concurrency, a seal and explicit completion:
all-required, partial or quorum. All-required discovery must match the owner population.
Coverage alone does not prove work was accepted: a separate closed collection ledger
binds each item's accepted assessment and candidate contribution. Population gates require
that ledger and retain every item's deltas/producers in the final candidate. Empty work
requires explicit allowNoWork in both population and acceptance contracts.

The initial inventory adapter enumerates files under captured `inventoryRoots` and optional
extensions. It is a concrete file inventory, not a semantic proof that a glob found all
components. Semantic populations require owner-supplied evidence and exact baseline pinning.
Exclusions require an inventory member and a reason. Population changes require a successor
run with a new captured contract; current replan cannot replace external contracts.

## Candidate acceptance and application

Candidates are immutable snapshot identities with ordered producer-specific deltas and
parents. A shared ancestor is composed once; equal patches from independent producers
are not silently deduplicated. Independent overlaps require resolution. Beforeimages,
captured environment context, source types and scopes are checked before local writes.

`completed` means a data program reached its typed result without a final acceptance gate.
It is a re-openable computation checkpoint; it does not authorize application. Replan and
resume are explicit owner decisions and the earlier state remains in immutable history.
`acceptance-ready` requires an owner-issued gate and `acceptedCandidate`. A declared
accepted result cannot bypass that gate or point to another candidate. Uncertain/active
attempts block completion and application. `applied` and `canceled` require explicit successor
runs for new work. No lifecycle state asserts human or production acceptance.

`program-apply` requires current version, gate and authorization provenance. The owner
commits ApplyIntent with candidate/program/contract digests, semantic version, seals and
expected files before the first write. Signals received during application stay
pending-after-apply. Publication checks each beforeimage, checks cancellation before each
write, and stores observed completion. Multiple files are not one filesystem transaction.
An interrupted/partial/divergent publication becomes apply-uncertain; it never silently retries.

Publication reconciliation accepts `publication: true` only after observing all expected
files. `publication: "retry"` requires authorization and the complete original baseline;
it clears the old intent and pauses for explicit resume/revalidation. Partial or divergent
files are preserved. Worker reconciliation requires attemptId, `resolution: "failed"`
and an observed reason; parent uncertainty is reconciled after its worker attempts.

## Durability, replan, effects and reuse

Each run has one checksummed authoritative atomic record in
`.forge/local/agent-fabric/program-runs`. Immutable artifacts and full stateRefs are fsynced
before referencing transitions. Every historical transition points to the exact state,
including prior programs, generations, decisions and counters. Store.history and artifact
get APIs inspect that history. Locks use linked complete owner files and guarded dead-owner
reclamation. Recovery marks incomplete dispatch/application uncertain and does not start work.
Process-crash/replay behavior is tested. Directory fsync/power-loss durability across every
filesystem is not asserted. Archive/GC is manual; preserving evidence consumes disk.

Barrier replan requires settled work. Additive replan preserves all existing templates;
after the previous scheduler cycle settles, controls and final gates are recomputed for
the new semantic version. Fenced replan is owner opt-in: affected operations/dependents
receive monotonic generations; running attempts become uncertain and receive abort requests.
It currently uses a **global scheduling barrier**. Unaffected running work may finish, but
resume waits for the scheduler to settle and uncertainty to be reconciled. Removed historical
operations are retired/skipped after observation; history is retained. This is not arbitrary
live replacement with independent branch schedulers.

Commands use explicit argv, resolved/hashed actual executables, scrubbed environment,
frozen clone inputs and optional locked dependencies with scripts ignored. They are
cooperative OS processes, not a network/filesystem sandbox. Strong disabled-network claims
are refused for commands. Codex workers use readonly/workspace-write sandbox, disabled
network and inherited MCP isolation. captureScope is distinct from write authority, allowing
readonly programs without granting source writes. Generated paths cannot conceal captured
source; external scratch is separate from candidate files. Cancellation does not prove a
process tree stopped; unknown outcomes require observation.

Outputs are not reused by default. `cache: "workspace"` is an owner declaration for command
executors whose complete relevant inputs are their captured workspace/data, observed binary,
dependency tree and environment. External/network/time/global filesystem inputs invalidate
that declaration unless separately closed by an adapter. Compatible completed outputs receive
explicit reuse receipts. SDK output reuse is disabled because effective global instructions,
plugins and model inputs are not yet fully attested. Prompt caching is a separate provider feature.

Recommended initial concurrency is four. Hard caps: concurrency32, depth32, items10000,
attempts10000, operations20000, output4MiB, state32MiB and20 plan revisions. Expression/DSL
expansion is bounded before concatenation/cloning. A dispatch reserve leaves record space
for recovery. These are limits, not measured performance claims at maximum scale.

## Verification and remaining scope

Tests cover finite lowering, output/generation/counter contracts, 80-item coverage, fabricated
receipts, no-work, events, cache attestation, recovery, additive/fenced races, real commands,
two-file composition, three same-file corrections, diamond ancestry, identical independent
patch conflicts, application idempotency, beforeimage preservation and authenticated transport.
The opt-in SDK pilot script performs a real readonly typed activity and records its bounded
evidence separately. It is excluded from normal CI to avoid account/model usage.

This alpha implements the bounded v2 foundation and conservative online controls. It does
not establish complete F6/F7 product acceptance, semantic inventory adapters, extensible recipe
registries, external effects exactly-once, streaming discovery, automatic GC, SDK output cache,
high-concurrency scale, a live independent-branch scheduler or Claude product superiority.
The benchmark harness labels its procedural comparison as a reference model, never as a
measured Claude run. Production/EasyGrow/native-hook/App-closed acceptance remains separate.
