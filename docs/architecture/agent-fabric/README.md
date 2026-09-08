# Forge Agent Fabric — Architecture Governance

This directory is the governance record for the Forge Agent Fabric architecture baseline.
It is deliberately separate from `docs/agent-fabric.md`, which describes the executable
P0a implementation surface.

## Governance package

| Record | Purpose |
| --- | --- |
| [`S1.0B1_DECISION_FREEZE.md`](./S1.0B1_DECISION_FREEZE.md) | Freezes the architecture decisions, vocabulary, invariants, boundaries, and deferred scope that later slices must preserve or explicitly supersede. |
| [`S1.0B2_EVIDENCE_FREEZE.md`](./S1.0B2_EVIDENCE_FREEZE.md) | Freezes the evidence proving the accepted P0a baseline and maps evidence to the frozen decisions/invariants. |
| [`P0A_ACCEPTANCE_RECORD.md`](./P0A_ACCEPTANCE_RECORD.md) | Records exactly what was accepted when P0a was merged, what was not accepted, and the applicability/supersession rules. |

## Baseline coordinates

- Repository: `Stahldavid/forge`
- Accepted implementation head: `bfd2639579e650d4ad38ec1a81dbd55a5d68865e`
- Merge commit on `main`: `8972496f09727456b8b9f3ceafc386beab5f39d0`
- PR: `#9 — feat: add Forge Agent Fabric P0a protocol kernel`
- PR merged: `2026-09-08T09:26:36Z`
- Pre-P0a base: `6f54ee728761bf91ff65465d798286d6f47fbe67`

The merge commit has the reviewed P0a head as its second parent. This means the accepted
implementation tree is traceable directly from `main` without relying on an external
branch remaining available.

## Status model

The P0a implementation itself is already merged and accepted as the executable baseline.
The governance records in this directory become the formally adopted S1.0B1/B2 records
when the pull request introducing this directory is merged to `main`.

Until that governance merge:

- P0a technical acceptance remains factual and unchanged;
- these files are the **proposed formal record** of that acceptance and of the architecture freeze;
- no later slice should treat wording in this branch as adopted architecture until it lands on `main`.

After adoption, changes must not silently rewrite history. A material change to a frozen
architecture decision requires a new superseding decision record that identifies:

1. the decision/invariant being superseded;
2. the reason for the change;
3. compatibility and migration impact;
4. new evidence and conformance obligations;
5. the exact commit at which the new decision becomes applicable.

Corrections that do not alter semantics (typos, links, formatting, evidence-location
updates) may amend these files directly, but must not change the meaning of frozen
invariants.

## Precedence

For the accepted P0a baseline, use this order when sources appear to disagree:

1. accepted executable behavior at `main@8972496f09727456b8b9f3ceafc386beab5f39d0`;
2. machine-readable schema and hardened replay/validation behavior in that baseline;
3. `P0A_ACCEPTANCE_RECORD.md`;
4. `S1.0B1_DECISION_FREEZE.md`;
5. `S1.0B2_EVIDENCE_FREEZE.md`;
6. `docs/agent-fabric.md`;
7. older design notes, handoffs, experiments, or conversation history.

This precedence rule prevents an older architecture note from overriding behavior that
was explicitly implemented, adversarially reviewed, and accepted.

## Scope boundary

The freeze does **not** declare the entire future Agent Fabric implemented or
production-ready. It distinguishes three categories:

- **ACCEPTED_P0A** — implemented, tested, independently reviewed, and merged;
- **FROZEN_DIRECTION** — architecture direction that later slices must respect but that
  is not fully implemented by P0a;
- **DEFERRED** — intentionally outside the accepted baseline and requiring a future slice
  and separate acceptance evidence.

The next planned architecture work may consume these records as inputs to S1.1
(Normative Kernel), but S1.1 is not created or adopted by this S1.0 package.
