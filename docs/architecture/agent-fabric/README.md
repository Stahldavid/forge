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
| [`S1.1_SCOPE_AND_GATE.md`](./S1.1_SCOPE_AND_GATE.md), [`S1.1_CONFORMANCE_PLAN.md`](./S1.1_CONFORMANCE_PLAN.md) | Adopted planning inputs for the normative kernel; historical planning assessments remain intact. |
| [`S1.1_NORMATIVE_KERNEL.md`](./S1.1_NORMATIVE_KERNEL.md), [`S1.1_CONFORMANCE_MATRIX.md`](./S1.1_CONFORMANCE_MATRIX.md) | Adopted operation rules, invariant traceability, conformance obligations and clarification register. |
| [`S1.1_ADOPTION_RECORD.md`](./S1.1_ADOPTION_RECORD.md) | Records the exact reviewed head, evidence and merge that adopted S1.1; explains retained candidate wording in historical artifacts. |
| [`S1.2_SCOPE_AND_GATE.md`](./S1.2_SCOPE_AND_GATE.md), [`S1.2_DESIGN_PLAN.md`](./S1.2_DESIGN_PLAN.md) | Proposal for the next documentation/design slice and its delivery plan; planning adoption is separate from adoption of the completed design. |

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

| Record / stage | Adoption event | State |
| --- | --- | --- |
| P0a executable acceptance | [PR #9](https://github.com/Stahldavid/forge/pull/9), `8972496f09727456b8b9f3ceafc386beab5f39d0` | Accepted |
| S1.0B1/B2 and P0a acceptance record | [PR #11](https://github.com/Stahldavid/forge/pull/11), `7a99ec5ceb2bdd51c83790fd84b23e534be52806` | Adopted |
| S1.1 scope and conformance plan | [PR #12](https://github.com/Stahldavid/forge/pull/12), `3a0ce40ffe31555709d213bf06d674c62f28ad32` | Adopted planning input |
| S1.1 kernel and conformance matrix | [PR #13](https://github.com/Stahldavid/forge/pull/13), `4b796f49c480d782ec7e069f8eb5f7eae841876a` | Adopted; G-14 complete |

The current adopted architecture baseline for the next slice is
`main@4b796f49c480d782ec7e069f8eb5f7eae841876a`. The P0a executable coordinates above
retain their historical meaning. Candidate/planning labels in the earlier documents are
preserved as authored; the adoption events and S1.1 adoption record establish their status.

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

S1.1 supplies the adopted operation-level specification of that same accepted behavior.
Its adoption does not reverse this precedence or authorize a discrepancy with the frozen
invariants. A conflict among source, freeze and kernel requires an explicit decision under
the existing change rule; S1.2 design prose cannot override any of them.

## Scope boundary

The freeze does **not** declare the entire future Agent Fabric implemented or
production-ready. It distinguishes three categories:

- **ACCEPTED_P0A** — implemented, tested, independently reviewed, and merged;
- **FROZEN_DIRECTION** — architecture direction that later slices must respect but that
  is not fully implemented by P0a;
- **DEFERRED** — intentionally outside the accepted baseline and requiring a future slice
  and separate acceptance evidence.

The proposed next step is S1.2 — Reference Implementation Design, scoped by the two
planning records above. This name/objective is a new proposal, not a recovered prior
decision. Merging those planning records adopts only the scope and gate. The complete
S1.2 design requires its own deliverables, exact-SHA review and adoption event. Neither
event authorizes runtime changes, S1.3 implementation or P0b.
