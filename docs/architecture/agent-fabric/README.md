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
| [`S1.2_SCOPE_AND_GATE.md`](./S1.2_SCOPE_AND_GATE.md), [`S1.2_DESIGN_PLAN.md`](./S1.2_DESIGN_PLAN.md) | Adopted scope and delivery plan for the reference implementation design. |
| [`S1.2_REFERENCE_IMPLEMENTATION_DESIGN.md`](./S1.2_REFERENCE_IMPLEMENTATION_DESIGN.md), [`S1.2_IMPLEMENTATION_TRACEABILITY.md`](./S1.2_IMPLEMENTATION_TRACEABILITY.md), [`S1.2_DESIGN_DECISIONS.md`](./S1.2_DESIGN_DECISIONS.md) | Adopted reference implementation design; 24 operation mappings, 35 invariant mappings, 16 event-family mappings and preserved S12-F01/F02 history. |
| [`S1.2_ADOPTION_RECORD.md`](./S1.2_ADOPTION_RECORD.md) | Records the exact reviewed head, checks, repair-aware evidence and merge that completed S12-D12 and adopted S1.2. |
| [`S1.3_SCOPE_AND_GATE.md`](./S1.3_SCOPE_AND_GATE.md), [`S1.3_CONFORMANCE_PLAN.md`](./S1.3_CONFORMANCE_PLAN.md) | Proposed S1.3 Proof & Conformance planning package. Defines a limited evidence/reproduction first stage and keeps new tooling/P0b unauthorized pending separate decisions. |

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
| S1.2 scope and gate | [PR #14](https://github.com/Stahldavid/forge/pull/14), `d1e6a1bb605527f242b7a6fb6fa05d6ff3561f92` | Adopted planning input; S12-P06 complete |
| S12-F01 compatible resource-rejection repair | [PR #15](https://github.com/Stahldavid/forge/pull/15), `d9275f4773c1082a993ffaf7b6a58d15eb139246` | Adopted separately; reviewed head `16157c8bd59feecef6aa31692ba90a0d94f84307` |
| S12-F02 compatible identifier-dictionary repair | [PR #17](https://github.com/Stahldavid/forge/pull/17), `2ca5ba7d261cf4001aa755581caa4b29de109b35` | FIXED_AND_ADOPTED separately; reviewed head `a832e29a3e8c757249eb8a59b7774d6521b4853e` |
| S1.2 complete reference design | [PR #16](https://github.com/Stahldavid/forge/pull/16), `d2f426b1577d457bc6609c4d8e88ef7a055a1a23` | `ADOPTED`; S12-D12 complete; reviewed head `a2ac1769ac74fe9f7a87558a27332aa7c2a95114` |
| S1.3 scope and conformance plan | No adoption event | `PLANNING_PROPOSAL`; S1.3 implementation and P0b remain unauthorized |

The current adopted architecture baseline for planning the next slice is
`main@d2f426b1577d457bc6609c4d8e88ef7a055a1a23`. The P0a executable coordinates above
retain their historical meaning. Candidate/planning labels in earlier reviewed files are
preserved as authored; their adoption merges and adoption records establish subsequent
status.

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
invariants. S1.2 supplies the adopted source/ownership/sequence mapping of that behavior;
it cannot override S1.1 or turn an implementation accident into a normative rule. A
conflict among source, freeze, kernel and adopted design requires explicit classification
under the existing change rule.

S1.3 evidence, if later adopted, will describe what was observed and how it can be
reproduced. Evidence metadata, a runner, a formal model or a signature cannot manufacture
runtime authority or silently change an `OP-*`/`I-*` obligation.

## Scope boundary

The freeze does **not** declare the entire future Agent Fabric implemented or
production-ready. It distinguishes three categories:

- **ACCEPTED_P0A** — implemented, tested, independently reviewed, and merged;
- **FROZEN_DIRECTION** — architecture direction that later slices must respect but that
  is not fully implemented by P0a;
- **DEFERRED** — intentionally outside the accepted baseline and requiring a future slice
  and separate acceptance evidence.

S1.2 — Reference Implementation Design is now adopted. Its three design artifacts map the
accepted implementation and preserve both historical MEDIUM findings, S12-F01 and S12-F02,
whose compatible repairs were separately adopted before the final design merge. S1.2
adoption does not authorize any next implementation slice.

The proposed next step is **S1.3 — Proof & Conformance**. The planning records in this
branch propose an evidence-first, limited first stage: organize existing evidence by the
24 OP rules, 35 invariants and 16 events; bind observations to exact source/execution SHAs;
define reproduction rules; and classify gaps. A generic runner, model checking, proof
signing, cross-language conformance, machine-readable automation and production evidence
retention are not automatically part of S1.3 and require demonstrated need plus separate
scope/acceptance before implementation.

Merging an S1.3 planning PR would adopt only its scope/evidence model/gates. Until that
planning receives exact-SHA checks, independent review and an explicitly authorized merge,
S1.3 remains unadopted. P0b remains outside the authorized scope.
