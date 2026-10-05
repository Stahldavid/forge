# Forge Agent Fabric

Forge Agent Fabric is an experimental protocol-oriented execution layer for dynamically materialized agents and workflows. It extends Forge's existing compiler, outbox, actions, workflows, policy, and agent runtime rather than replacing them.

## Implementation status

The Codex-accompanied task mode now records acceptance criteria, scoped source snapshots,
independent review and checks in a persistent local task. Its dynamic workflow scheduler
supports dependencies, decisions, joins, bounded retries, replanning and crash reconciliation.
Codex executes the steps with its native tools; the scheduler does not start models or
continue execution when the host is closed. The
[detailed implementation and operation plan](./architecture/agent-fabric/CODEX_DYNAMIC_WORKFLOWS.md)
documents both contracts, evidence provenance and the remaining acceptance work.
The project skill is `.agents/skills/forge-agent-fabric/SKILL.md`.

```bash
node bin/forge.mjs fabric capabilities --json
node bin/forge.mjs fabric serve --json
node bin/forge.mjs fabric attached-context --task-id <task-id> --json
```

Accompanied CLI and MCP operations share the running owner. Successful workflow results
name the source snapshot actually observed; old evidence cannot complete a changed task.
The older protocol kernel and local Ollama pilot retain their separate contracts below.

### Managed Codex SDK execution

Managed runs are now implemented separately from accompanied tasks. The native Codex
chat remains the user interface: prepare JSON and call the source CLI, or use the
`fabric_run_*` tools if this MCP is already registered. This delivery does not register
MCP or change global settings. `run-start` starts processes and can consume configured
Codex credits; it is more than a proposal. Capabilities distinguish these effects by mode.

```bash
node bin/forge.mjs fabric run-start --file run.json --json
node bin/forge.mjs fabric run-status --run-id <run-id> --json
node bin/forge.mjs fabric run-wait --file wait.json --json
node bin/forge.mjs fabric run-pause --file pause.json --json
```

The [complete request example and operating plan](./architecture/agent-fabric/CODEX_DYNAMIC_WORKFLOWS.md)
includes a command-only smoke and a coding DAG. Start requires requestId, goal, scope,
workflow nodes and one executor per node. Executors are `codex` or `command`; Codex roles
are implementer, reviewer, investigator and decision. Implementers declare writeScope.
The owner persists attempts before dispatch and runs workers in isolated Git clones,
composing dependency artifacts. Clones do not copy the root's node_modules. Automatic
environment preparation installs from the clone's manifest and lockfile or copies a
verified cache. Scripts are ignored by default; dependencies are isolated, not shared
through a mutable folder. The optional environment object accepts mode auto/none,
ignoreScripts, timeoutMs (100..1800000) and an HTTPS registry without credentials, query
or fragment. Reviewers and commands are read-only after environment preparation.

Controls are run-steer/pause/resume/cancel/reconcile. Mutations require
`{runId,requestId,expectedVersion}` and complete `--file` bodies. Reuse requestId only for
the identical body; after a version conflict read status and choose a new requestId.
Status reads use `--run-id`; wait uses `{runId,cursor?,waitMs?}`, with at most 30000 ms.
Responses expose events and cursorExpired so clients can recover a missed event window.
MCP status accepts `{runId}`; all other managed tools accept `{request: BODY}`.

Steer queues an instruction and pauses future dispatch; active workers may finish.
Resume can replan with expectedRevision, nodes, executors, reason and evidenceRefs.
Cancel requests interruption, but unknown effects require explicit reconciliation.
Interrupted attempts accept only resolution `failed` with attemptId and reason;
caller-fabricated success is rejected. A fresh isolated attempt may resume its saved SDK
thread. Uncertain publication accepts `publication: "confirm"` only when the owner observes
the expected root files.
Publication retry requires the observed complete original baseline, clears the intent,
pauses the run and requires explicit resume; partial divergent writes remain blocked.
State provenance is executor_observed; model report contents
remain agent_reported. Required evidence labels accept only `executor-observed`.

When implementers exist and publish is not false, local publication requires a required
Codex review and command check downstream of every writer, approved review, successful
checks and completed workflow. Publication applies scoped diffs to a compatible root;
it does not commit, push or deploy. publish false retains isolated artifacts instead.
Use only the user's existing authorization for effects and cost.

Both managed and accompanied operations require one live owner and have no direct-store
fallback. There is no automatic wakeup, installed background service or promise of
running after the App closes. Restarted active attempts become uncertain. Implemented
transport and real command tests alone do not establish the real SDK pilot; the separate
real pilot is recorded in section 14 of the detailed plan. The accompanied validation results below are historical and do
not certify subsequently added managed code. Interactive App Server integration, native
hook acceptance and an EasyGrow pilot remain separate proposed work.

### Faster CI, unchanged publication gates

The main CI classifies changed paths before optional template, package and runtime smokes.
Package smoke runs as an independent parallel job instead of extending the compiler
verification job. Unrelated agent modules skip template setup; Nuxt smoke excludes agent
modules too. Missing Git history conservatively runs every optional check. New pushes
cancel obsolete CI runs. Security Assurance uses its aggregate proof for guardrails,
auth, secrets and RLS instead of repeating those commands, while retaining the broader
security test suite and evidence artifacts. Publication keeps its complete release gates.
The previous observed CI was about 170 seconds, including a 64-second final package smoke;
the parallel design shortens that critical path, but the next hosted run must measure
the actual improvement.

The deterministic P0a protocol kernel and the bounded P0b-A model adapter are implemented.
P0b-A invokes one real model through the existing P0a permit and result boundary. Its
accepted scope and exact adoption evidence are recorded in
[`P0B_A_ADOPTION_RECORD.md`](./architecture/agent-fabric/P0B_A_ADOPTION_RECORD.md).

The local coding pilot has bounded proposal validation, a single-process PGlite
control journal, browser-based owner review, an isolated Ollama coding worker,
and MCP proposal/status tools backed by a local owner process. It does not make
a production persistence or security claim. Its scope and remaining gates are
in [`P0B_B_LOCAL_CODING_SCOPE.md`](./architecture/agent-fabric/P0B_B_LOCAL_CODING_SCOPE.md).
The [single-owner acceptance matrix](./architecture/agent-fabric/LOCAL_SINGLE_OWNER_ACCEPTANCE.md)
separates the current local implementation from its remaining release and human
acceptance gates.
Owner-selected local memory, fixed two-process data workers, and a standalone
Evolution Registry have separate narrow workflows below. These do not grant
the Ollama coding worker new tools or executable extensions.

`LocalAdaptiveHarness.run()` is a fixed local demonstration of two permitted
Node processes (`inventory` and `constraints`) followed by an authoritative
join. Each child receives only bounded text on stdin, an empty environment,
and a one second wall limit. The coordinator validates each digest against its
own input before committing the P0a result; cancellation, timeout, or an
invalid report leaves the join blocked. This trusted data worker is not an
arbitrary coding agent or an OS security sandbox.

The single-PC CLI wraps that harness with a local owner decision and durable
readback. From the repository root, create a JSON file with exactly two fields,
for example `{"inventory":"src/a.ts","constraints":"read only"}`. Each field
is data of at most 256 UTF-8 bytes. Then run:

```bash
node bin/forge.mjs fabric adaptive-propose --file input.json --json
node bin/forge.mjs fabric adaptive-review <run-id> --json
node bin/forge.mjs fabric adaptive-run <run-id> --json
node bin/forge.mjs fabric adaptive-status <run-id> --json
```

To narrow the two data fields through an owner-selected Evolution profile,
pass `--channel canary` or `--channel stable` to `adaptive-propose` after that
channel has a selected `local-adaptive-input-profile` version. The proposal
binds the immutable version ID before review. The owner window displays it,
and `adaptive-run` checks that the same version remains selected and loadable
before issuing permits. A changed or revoked selection blocks the run. The
profile validates labels and lengths only; it does not provide code, tools,
instructions, or worker behavior.
Profile decisions and an adaptive run share a local process lock, so a
promotion or revocation cannot race between profile readback and worker dispatch.

`adaptive-review` opens a loopback browser window showing both exact inputs,
the bound profile version when present, and their proposal digest. The approval
expires after five minutes and permits one run. The
CLI commits the owner authorization, fixed plan, child grants, and both P0a
permits to a separate local PGlite journal before starting either process.
The result record and authoritative join can be read after closing and
reopening the CLI. If the process dies after committing the join but before
saving the result record, status still reports the authoritative join but may
omit process IDs and child details. A run cannot be repeated; a crash after
dispatch is shown as uncertain unless the durable journal contains the join.
Cancellation, failed workers, or missing results never authorize a join.
Local records and the owner verifier key live under `.forge/local/agent-fabric`.
The local owner lock prevents concurrent mutating CLI invocations; after a
crash, inspect `adaptive-status` before any manual lock recovery. This is a
single-PC workflow, not a production security or multi-host claim.

The following remain explicitly deferred and must not be inferred from architecture notes, historical handoffs, or local experiments:

- model-selected tools, plugins or child delegation (the local data workers use
  fixed code-owned child permits only);
- PGlite-backed production persistence/outbox integration for Agent Fabric;
- general consequential-effect brokers and arbitrary external-system effects
  (the local pilot has fixed patch and Docker verification receipts only);
- recovery epochs and integrity-unknown recovery;
- adaptive model routing and general harness compilation beyond the fixed
  two-process data workflow;
- executable plugin promotion, shared production memory, and autonomous self-evolution;
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
from the root of a trusted Git repository with Ollama running and `qwen2.5-coder:3b`
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
node bin/forge.mjs fabric cancel <task-id> --json
node bin/forge.mjs fabric reconcile <task-id> --json
node bin/forge.mjs fabric verify <task-id> --json
node bin/forge.mjs fabric review-result <task-id> --json
node bin/forge.mjs fabric serve --json
```

`task.json` is an untrusted proposal. Its required fields are `schemaVersion: 1`,
`repositoryId`, the full `baseCommit`, `goal`, `acceptanceCriteria`, `nonObjectives`,
`sourcePaths`, `writablePaths`, `requestedModelTargetId: "target:ollama:local"`,
`requestedModelId: "qwen2.5-coder:3b"`, and
`limits` with `maximumAttempts`, `maximumWallClockMs`, `maximumOutputTokens`,
`maximumContextBytes`, `maximumPatchBytes`, and a Unix millisecond `expiresAt`.
`review` opens a local browser window showing the exact proposal and digest; `run`
consumes one approved model attempt and writes a diff in an isolated Git worktree.
The model ID is part of that digest and appears in the owner review. Existing
tasks approved before model pinning cannot start a new model call; submit a fresh
proposal. Their saved outcomes and patches remain available for readback, while
the exact model for a legacy outcome is reported as unknown.
The service captures the allowlisted tracked source files at the exact current
HEAD when proposing and rechecks them before spending the approved model
attempt. Changed source content or HEAD blocks a stale attempt.
`cancel` revokes an unused owner approval so `run` cannot start it, including after
the owner restarts. During an active model call, it requests abort from the
local adapter. The returned `model_uncertain` state does not prove the provider
stopped; a dispatched attempt cannot be retried. Cancellation does not stop
patch materialization or Docker verification that has already started. Start
`fabric serve` before `run` when you need a second CLI process to cancel an
in-flight call; a one-shot `run` has no cross-process abort endpoint.
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
After `run` produces a patch, `verify` checks deterministic test paths,
mount encoding, Docker context, and the pinned image before recording a durable
intent. A dispatch barrier is recorded before container execution. The owner
can clear only an intent that has no dispatch barrier; a potentially started
container cannot be retried automatically. `git diff --check` runs with external
diff and filesystem monitor helpers disabled on the host; Node tests run inside
Docker Desktop without network, with an
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

### Codex App implementation with adversarial review (local preview)

The Codex App may implement a change in the current checkout. Register the work
before editing with a JSON request such as
`{"objective":"Change the parser","acceptanceCriteria":["The new case is handled"],"implementer":"codex-app"}`.
Place the request under the ignored `.forge/local/` directory, then use:

```bash
node bin/forge.mjs fabric change-propose --file .forge/local/change-request.json --json
node bin/forge.mjs fabric change-status --task-id <change-id> --json
node bin/forge.mjs fabric change-review --task-id <change-id> --json
node bin/forge.mjs fabric change-evidence --task-id <change-id> --json
```

`change-review` is an explicit owner CLI action that starts a **new Codex CLI
review turn** using the machine's existing Codex login. That turn may consume
Codex usage. The MCP tools `fabric_change_propose`, `fabric_change_status`, and
`fabric_change_evidence` can register and inspect a change but cannot start a
review or mark it accepted. The request pins the base commit; review later
captures staged, unstaged, and non-ignored new files without modifying the
user's Git index. Local Forge state under `.forge/local` and `.forge/delta` is
excluded. A review is limited to 1 MiB, 100 paths, and eight rounds; binary
patches, symlinks, and submodules are rejected.

Each round records an immutable diff and request digest before dispatch. The
reviewer runs against a separate checkout of that exact diff in read-only
sandbox mode. A valid structured report bound to the request digest is required;
process exit zero alone is insufficient. `canAccept` becomes true only for a
passing report on the **current** diff. Editing the checkout after a pass makes
it `needs_review`, and the next review creates a new round. An interrupted
review remains uncertain and will not automatically spend another turn. An
inconclusive completed review may be retried explicitly. For an interrupted
review, inspect its evidence and create a fresh change request if another paid
turn is warranted; the uncertain intent remains in the original record.
`canAccept` is evidence for the human workflow; this preview does not intercept
Git merges or edits made outside the CLI. Same-account shell access can alter
the local ledger and is outside the pilot's security boundary. The Codex CLI
review protocol has fake-process tests but no paid, real-model smoke yet.

### Local Evolution Registry (single owner)

The local extension workflow pins a candidate's bytes before evaluation. A
manifest is a repository file with exactly these fields:

```json
{"schemaVersion":1,"extensionKey":"sample","artifactPath":"extensions/sample.js"}
```

The artifact and manifest must be regular files inside the repository. The
artifact is limited to 1 MiB and the manifest to 16 KiB. Forge copies both to
content addressed files under `.forge/local/agent-fabric/evolution/`; edits to
the source files after registration do not change the registered version.

```bash
node bin/forge.mjs evolution register --manifest extensions/sample.json --json
node bin/forge.mjs evolution evaluate extension:sha256:<digest> --json
node bin/forge.mjs evolution status extension:sha256:<digest> --json
node bin/forge.mjs evolution review canary extension:sha256:<digest> --json
node bin/forge.mjs evolution review promote extension:sha256:<digest> --json
node bin/forge.mjs evolution load sample --channel stable --json
node bin/forge.mjs evolution review rollback extension:sha256:<older-digest> --json
node bin/forge.mjs evolution review revoke extension:sha256:<digest> --json
```

Evaluation is a fixed local suite that checks stored artifact integrity,
stored manifest integrity, and the manifest contract. It does not execute the
candidate. Each version evaluates once; a failed or interrupted evaluation
requires a new candidate version. Canary, promotion, rollback, and revocation
open a loopback owner review window. Rejection or timeout leaves selection
unchanged. Rollback can select only a previously stable version that still has
a passing evaluation. Revocation clears selections and blocks future loading.

The `load` command reports verified metadata. Local runtime callers can use
`LocalEvolutionService.loadSelected` to obtain bytes after the same channel,
evaluation, revocation, and digest checks. This registry does not import or
execute those bytes or grant them side effects. Its review window is a
cooperative human checkpoint; same-account shell or browser automation is
outside its protection boundary. No hosted model or API key is used.
