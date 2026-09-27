# Local Evolution Registry scope

Status: implemented library slice; **not adopted as a complete Agent Fabric step 11 capability**.

## Boundary

`LocalEvolutionRegistry` is a single-owner PGlite component. Registration accepts an
untrusted candidate containing an extension key plus artifact and manifest SHA-256
digests. It stores no executable artifact and never loads code. The version ID is the
canonical digest of those three immutable fields. Duplicate registration of the same
content returns the existing version.

A trusted host supplies one fixed suite ID, ordered case IDs, and the suite digest
derived from both. An injected evaluator returns one bounded digest and pass/fail
result per case. The registry persists a `running` record before invoking it and a
terminal result afterward. A killed process can leave `running`; an evaluator error or
invalid result becomes `inconclusive`. Neither state permits selection. Repeating the
same evaluation is blocked, so recovery requires a separately designed re-evaluation
revision rather than silently repeating possible effects.

Canary, promotion, rollback, and revocation require an injected trusted owner verifier.
The verifier receives a fresh nonce and a challenge binding the action, exact version,
extension key, expected current selection, and evaluation digest. Its proof must bind
that challenge.
Selections and decision receipts commit together in a PGlite transaction. A failed
suite blocks selection. Rollback targets a previously stable version that still has
a passing evaluation. Revocation clears any selected channel for that exact version.
There is no implicit fallback. Attempts bind an exact selected version in a transaction;
old bindings remain readable after promotion or revocation, but a revoked version
cannot be newly selected. Reusing an attempt ID is rejected; `getAttempt` is the
readback path and must never dispatch an effect.

## Integration gates

- Only trusted server code may construct the registry and its owner verifier. Wire the
  verifier to the separate owner decision window; never expose `decide` through model,
  task text, CLI flags, or MCP tools as a self-approval route.
- The evaluator must run the exact reviewed fixed cases in an isolated environment and
  produce case evidence digests. The registry records evidence but does not attest the
  evaluator or run the suite by itself.
- The executor must read the artifact from trusted storage and check both its bytes
  and manifest against the pinned digests before use. It must call `bindAttempt` before
  execution and record the returned version ID in the attempt's authoritative journal.
- Preserve PGlite's single-process owner boundary. This library does not implement
  multi-host locks, extension loading, package trust, automated canary metrics,
  re-evaluation recovery, or a runtime extension dispatcher.

## Focused evidence

`bun test tests/agent-fabric/local-evolution-registry.test.ts` exercises fixed-suite
pass/fail/inconclusive results, owner rejection, stale decisions, canary/promotion,
rollback, revocation, immutable attempt versions, and PGlite reopen. Typecheck and
the repository's generated checks remain release gates. These tests prove the local
registry state machine, not live extension execution.
