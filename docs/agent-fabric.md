# Forge Agent Fabric

Forge Agent Fabric is an experimental protocol-oriented execution layer for dynamically materialized agents and workflows. It extends Forge's existing compiler, outbox, actions, workflows, policy, and agent runtime rather than replacing them.

## Implementation status

The deterministic P0a protocol kernel and the bounded P0b-A model adapter are implemented.
P0b-A invokes one real model through the existing P0a permit and result boundary. Its
accepted scope and exact adoption evidence are recorded in
[`P0B_A_ADOPTION_RECORD.md`](./architecture/agent-fabric/P0B_A_ADOPTION_RECORD.md).

The local coding pilot has bounded proposal validation, a single-process PGlite
control journal, browser-based owner review, an isolated Ollama coding worker,
and MCP proposal/status tools backed by a local owner process. It does not make
a production persistence or security claim. Its scope and remaining gates are
in [`P0B_B_LOCAL_CODING_SCOPE.md`](./architecture/agent-fabric/P0B_B_LOCAL_CODING_SCOPE.md).

The following remain explicitly deferred and must not be inferred from architecture notes, historical handoffs, or local experiments:

- model-selected tools, plugins or child delegation beyond P0b-A;
- PGlite-backed production persistence/outbox integration for Agent Fabric;
- consequential-effect brokers and reconciliation against real systems;
- recovery epochs and integrity-unknown recovery;
- adaptive model routing/harness compilation beyond the P0a contracts;
- plugin promotion, persistent memory, and governed self-evolution;
- production deployment or production security claims.

## P0a scope

The first vertical implements a deterministic control kernel with:

- explicit `OwnerAuthorization`, `GoalContract`, `RunPlanRevision`, `PlanDelta`, `AgentSpec`, `HarnessSpec`, `ExecutionProfile`, and `EffectiveRunSpec` contracts;
- an immutable-by-copy control journal with sequence, predecessor, digest chain, and deterministic reducer;
- owner authorization ingress through an injected verifier, with content-bound verification evidence recorded in the journal and revalidated during replay;
- root grants bound to an explicit verified owner authorization;
- exact binding between a permit's grant/root authorization and the `GoalContract.authorityInvocationId` of its active plan;
- child grants with monotonic attenuation and transitive revocation;
- resource reservation plus child-grant registration as one in-memory transactional operation;
- a Conductor-owned internal `ResourceLedger`, seeded from constructor definitions and hydrated from authoritative replay on resume;
- replay-side reconstruction of consumable, capacity, and counter accounting from trusted resource definitions and journaled reservation transitions;
- globally unique attempt identities, one claim lineage per attempt, and at most one execution permit per attempt;
- durable dispatch intent, non-authoritative offers, atomic claims, leases, fencing, and attempt-bound permits;
- deterministic adapter protocol behavior;
- worker result reports bound to permit, intent, plan revision, `EffectiveRunSpec`, and fencing generation;
- replay-side recomputation of the canonical `WorkerResultReport` digest from the persisted outcome fields;
- authoritative `succeeded | failed` outcome commit that preserves result-report provenance and rejects stale or revoked ancestry;
- late `AttemptUncertaintyObservation` evidence that does **not** become a terminal authoritative outcome and therefore does not by itself block retry;
- plan revisions that preserve `GoalContract` and workflow program identity and are exactly derivable from a registered `PlanDelta`;
- runtime event validation and a closed JSON Schema envelope/payload model;
- crash/replay reconstruction without re-running a planner.

P0a intentionally does not implement external effects, persistent memory, model routing, plugin promotion, or production deployment.

## Live transition rule: replay-valid before append

The public P0a `ForgeAgentConductor` wraps the underlying journal with replay prevalidation. Before a new authoritative event is appended, the candidate prefix is reconstructed with the same sequence/predecessor/digest rules and must be accepted by the hardened replay semantics.

```text
current trusted journal prefix
+ candidate event
        ↓
hardened replay validation
        ↓
accept → append with journal CAS
reject → no append
```

This closes the class of bugs where a public Conductor method returns success but leaves an append-only journal that the same P0a implementation cannot replay.

The Conductor also pins its clock once per synchronous state transition so payload timestamps and the enclosing authoritative event timestamp are derived from the same clock observation when equality is part of the protocol invariant.

## Authority model

A workflow may choose how to work, but it may not create authority. The reference Conductor requires an `OwnerAuthorizationVerifier` before it can admit an `OwnerAuthorization`. The verification result is content-bound to the authorization digest and the replay path requires a trust-bound verifier to validate the recorded evidence again.

Root grants must remain within that authorization. Child grants must be strict subsets of their parent and remain invalid if:

- any ancestor is revoked or expired;
- the root authorization is revoked or expired;
- the child reservation is missing or has been released.

A grant is not sufficient merely because its capabilities/sources/targets fit an intent. Before permit issuance and during replay, P0a resolves:

```text
permit
→ dispatch intent
→ active RunPlanRevision
→ GoalContract
→ GoalContract.authorityInvocationId
→ exact OwnerAuthorization
```

The grant's `rootAuthorizationId` must equal that goal authority invocation, the authorization must include the goal, and authorization/plan/intent must belong to the same root execution.

```text
authenticated owner authorization
  -> trusted ingress verification
  -> root execution grant
  -> derived child grant + resource reservation
  -> dispatch intent
  -> dispatch offer (not authority)
  -> scheduling claim + lease + fencing
  -> attempt execution permit
  -> executor startup report
  -> worker result report
  -> conditional authoritative succeeded|failed outcome commit
```

The concrete production identity provider, signature/trust-root mechanism, and credential lifecycle are deliberately outside P0a; the kernel only requires a verifier contract with deterministic/offline verification of recorded admission evidence.

## Attempt identity and result binding

`attemptId` is a stream-global identity, not merely a caller convenience. A second claim may not reuse an existing attempt ID, even for another intent, and an attempt may receive only one execution permit. Hardened replay independently checks the one-per-attempt permit invariant so a fabricated journal cannot bypass the live Conductor check.

A `WorkerResultReport` is explicitly bound to:

- `attemptId`;
- `permitId`;
- `intentId`;
- `planRevisionId`;
- `effectiveRunSpecDigest`;
- `fencingToken`.

The report digest covers those fields as well as status, result digest, evidence digests and report time. `commitOutcome()` runtime-validates the report and compares it against the persisted permit/claim/intent lineage before it can become authoritative. Hardened replay reconstructs the report representation from the persisted outcome fields and recomputes the digest; a journal cannot claim an unrelated `reportDigest` while keeping different report fields.

## Resource atomicity and replay

P0a uses `ResourceLedger.transaction()` to make reservation and child-grant journal registration atomic within the in-memory reference implementation. If journal registration fails, the ledger snapshot is restored, including consumable, capacity, and counter state.

The public Conductor does **not** retain caller-owned mutable ledger state as authority. When resource definitions are supplied at construction, it clones those definitions into a Conductor-owned internal ledger. On resume from an existing journal, the internal ledger is hydrated from the authoritative replay projection before new resource transitions are allowed. An empty constructor seed therefore cannot erase prior usage, and later out-of-band mutations of the caller's seed cannot change authority state. A conflicting non-empty seed fails closed.

The replay path does not accept a reservation merely because its shape matches a child grant. Resource definitions and limits are supplied through the replay trust context; reservation transitions are reapplied to reconstructed global/owner accounting. Duplicate resources, unknown resources, invalid transitions, or aggregate global overcommit fail closed.

Reservation `consume` and `release` operations have journaled transitions when performed through the Conductor. Releasing the reservation backing a derived grant makes that grant lineage non-current for future permits/startups/outcomes.

This remains an in-memory protocol proof. A later persistence slice must implement the same atomicity and journal coupling with a real transactional store/outbox.

## Uncertainty is not an authoritative outcome

P0a deliberately separates:

```text
AttemptUncertaintyObservation
!=
AuthoritativeOutcomeCommit
```

A late worker/adapter observation may say that startup or completion is uncertain even after a lease, permit, plan or grant has become stale. The observation is retained as evidence, but it does not make the intent terminal and cannot by itself block a later scheduling claim.

`executeP0aActivity()` preserves uncertainty not only when an adapter throws or explicitly returns `unknown`, but also when a positive startup/result report arrives too late or otherwise fails authoritative admission. The stale positive report does not regain authority; the control plane stores only a non-terminal uncertainty observation describing the rejected report path.

Only a currently authorized control path may commit a terminal P0a outcome, and P0a terminal outcomes are limited to `succeeded | failed`.

## Replay model and trust boundary

`MemoryControlJournal` stores cloned/frozen events and returns clones to callers. Every committed envelope carries:

- monotonic sequence;
- predecessor event ID;
- predecessor event digest;
- event digest;
- monotonic authoritative timestamp.

The public `replayControlState()` adds hardened protocol checks over the deterministic reducer and revalidates:

- a single `rootExecutionId` for the control stream;
- the digest chain and event shape;
- trusted owner-authorization evidence;
- exact GoalContract ↔ grant/root-authorization binding for execution permits;
- grant ancestry, reservation currentness and revocation;
- resource accounting against trust-bound definitions;
- global attempt/resource budgets;
- stream-unique event/idempotency/result identities;
- globally unique attempt identity;
- at most one permit per attempt;
- exact plan-delta lineage;
- claims, permits, startup and authoritative outcome bindings;
- canonical `WorkerResultReport` digest consistency.

Malformed replay input is normalized to `AgentFabricError(AF_INVALID_EVENT)` rather than leaking implementation-level exceptions such as `TypeError`.

The event hash chain is an **integrity mechanism, not a signature or proof of storage origin**. P0a assumes the journal prefix supplied for authoritative replay comes from the trusted journal/storage boundary. The reducer determines whether that prefix is semantically admissible; production durable storage/authentication of journal bytes is intentionally deferred to the persistence slice.

This distinction is important: arbitrary attacker-created bytes do not become authoritative merely because they form a self-consistent hash chain.

## Canonicalization scope

P0a currently uses `forge-canonical-json/v0.1`, a deterministic TypeScript/JavaScript reference profile with SHA-256. Canonicalization is defined over the JSON data model, not arbitrary JavaScript object behavior: objects must be plain or null-prototype data objects with own enumerable data properties, arrays must be dense and cannot carry extra/symbol properties, accessors are rejected, and an own property named `__proto__` is preserved as ordinary data and therefore participates in the canonical bytes and digest. This prevents different admitted in-memory values from collapsing to the same canonical representation through JavaScript prototype semantics.

The profile is **not** claimed to be the final cross-language canonicalization standard. A future protocol revision must adopt a cross-language profile (for example RFC 8785/JCS or an equivalently specified profile) with shared test vectors before Java/Python/Rust implementations are expected to produce identical digests.

## Public API

The experimental package API is exported only through:

```ts
import {
  ForgeAgentConductor,
  MemoryControlJournal,
  ResourceLedger,
  DeterministicTestAdapter,
  replayControlState,
} from "forgeos/agent-fabric";
```

That public entry point exposes the hardened Conductor and hardened replay functions. The lower-level implementation modules remain internal implementation detail of the experimental P0a package surface.

## Local coding pilot (experimental)

The framework checkout also exposes a bounded single-owner CLI path. Run these commands
from the root of a trusted Git repository with Ollama running and `qwen3:0.6b`
installed. This pilot uses no hosted API key or Codex model turn.

```text
node bin/forge.mjs fabric capabilities --json
node bin/forge.mjs fabric propose --file task.json --json
node bin/forge.mjs fabric memory-add --file note.json --json
node bin/forge.mjs fabric memory-list --file paths.json --json
node bin/forge.mjs fabric memory-delete <memory-id> --json
node bin/forge.mjs fabric status <task-id> --json
node bin/forge.mjs fabric evidence <task-id> --json
node bin/forge.mjs fabric review <task-id> --json
node bin/forge.mjs fabric run <task-id> --json
node bin/forge.mjs fabric reconcile <task-id> --json
node bin/forge.mjs fabric verify <task-id> --json
node bin/forge.mjs fabric review-result <task-id> --json
node bin/forge.mjs fabric serve --json
```

`task.json` is an untrusted proposal. Its required fields are `schemaVersion: 1`,
`repositoryId`, the full `baseCommit`, `goal`, `acceptanceCriteria`, `nonObjectives`,
`sourcePaths`, `writablePaths`, `requestedModelTargetId: "target:ollama:local"`, and
`limits` with `maximumAttempts`, `maximumWallClockMs`, `maximumOutputTokens`,
`maximumContextBytes`, `maximumPatchBytes`, and a Unix millisecond `expiresAt`.
`review` opens a local browser window showing the exact proposal and digest; `run`
consumes one approved model attempt and writes a diff in an isolated Git worktree.
The service captures the allowlisted tracked source files at the exact current
HEAD when proposing and rechecks them before spending the approved model
attempt. Changed source content or HEAD blocks a stale attempt.
`review-result` shows the recorded diff for a separate owner decision. Acceptance
records a decision only; it does not alter the original checkout or merge code.

Private memory is opt in and local to this checkout. `memory-add` reads a JSON
file such as `{ "sourcePaths": ["src/example.ts"], "text": "Owner note",
"retentionMs": 86400000 }`; `memory-list` reads a JSON file containing only
`sourcePaths`. Both require an unchanged tracked source snapshot. Notes are
bounded to 2 KiB, retained for at most 30 days, and stored under
`.forge/local/agent-fabric`. `memory-delete` removes a note by its returned ID.
To select notes for a coding task, add `"memoryIds": ["memory:<id>"]` to
`task.json` using returned full IDs. The proposal digest binds those IDs; the
owner review displays their text and provenance. Missing, expired, deleted, or
source-stale notes block approval or execution. Selected notes consume the
existing context byte budget and are labeled `untrusted_memory` in the model
context. MCP task tools cannot add, list, or delete private memory.

An optional `verification` field binds an immutable local Docker image ID and
two to four bounded command descriptors into the proposal digest. The first
descriptor is `{ "kind": "git-diff-check", "timeoutMs": 5000 }`; the remaining
descriptors are `{ "kind": "node-test-file", "path": "pass.test.mjs",
"timeoutMs": 20000 }`. The owner sees these exact commands and image in the
approval window. The image ID must match the locally installed `node:22`
image with a `node@sha256` registry digest; the service rejects a proposal
pointing to another local image and rechecks the tag before execution.
Each Node test file must exist in the pinned commit and be outside the task's
writable paths, so the model cannot replace the test that judges its patch.
After `run` produces a patch, `verify` checks deterministic test paths and
mount encoding, then records a durable
dispatch intent before running checks. A lost process leaves the verification
state `started`, which cannot be retried automatically. `git diff --check` runs
on the host; Node tests run inside Docker Desktop without network, with an
immutable already-installed image, read-only checkout, nonroot user and resource
limits. Accepting a patch with an approved verification profile requires all
checks to pass; a failed or uncertain result can still be rejected by the owner.

The local store lives under `.forge/local/agent-fabric` and has one PGlite process
owner. Start `forge fabric serve` to keep that owner running while separate CLI
and MCP clients connect through a loopback endpoint. The endpoint token stays in
the local repository store and is not printed. The MCP tools `fabric_propose`,
`fabric_status`, and `fabric_evidence` use that same owner; they cannot approve,
run, or accept a task. `fabric_evidence` returns a digest-bound provenance summary
without raw model text or diff content.
Without a running owner, CLI commands open the store for a single operation and
MCP task tools report that the owner is unavailable. A crashed model attempt with
a committed permit and no outcome remains
uncertain; a repeated `run` does not spend another attempt. A committed model result
can be materialized after restart if no patch-effect intent was issued. Patch
materialization records a durable intent before creating the isolated checkout.
A crash after that intent reports `patch_uncertain`; `run` will not reapply it.
`fabric reconcile` reads the checkout and diff artifact against the committed
model result and records a receipt only when they match exactly. It never
creates or rewrites the patch. The existing MCP server reports the boundary
through `fabric_capabilities`. The popup is
a cooperative same-account interaction, so it is not a security boundary against
an agent with unrestricted shell or UI control. The model receives only approved
source files and cannot run shell commands. The Git worktree confines patch
materialization; optional Node verification is container isolated. This pilot
does not yet broker arbitrary consequential effects or attest to sandbox escape
resistance against a hostile local administrator.

Maintainers can run `bun scripts/agent-fabric-local-smoke.ts` for an opt-in real
Ollama fixture. That script injects a synthetic test approval and confirms a diff;
it does not prove the human popup flow or coding quality on real projects.
`FORGE_FABRIC_DOCKER_SMOKE=1 bun test tests/agent-fabric/local-task-service.test.ts`
exercises the service, approved verification, Docker Desktop, durable readback,
and acceptance with a synthetic approval callback.
