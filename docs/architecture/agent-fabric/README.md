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
| [`S1.3_SCOPE_AND_GATE.md`](./S1.3_SCOPE_AND_GATE.md), [`S1.3_CONFORMANCE_PLAN.md`](./S1.3_CONFORMANCE_PLAN.md) | Adopted S1.3 Proof & Conformance planning package; S13-P08 complete. It authorizes only the limited S1.3-A evidence/reproduction stage, not new tooling or P0b. |
| [`S1.3_EVIDENCE_CATALOG.md`](./S1.3_EVIDENCE_CATALOG.md), [`S1.3_CONFORMANCE_MATRIX.md`](./S1.3_CONFORMANCE_MATRIX.md), [`S1.3_REPRODUCTION_PROTOCOL.md`](./S1.3_REPRODUCTION_PROTOCOL.md), [`S1.3_GAP_AND_TOOLING_REGISTER.md`](./S1.3_GAP_AND_TOOLING_REGISTER.md) | S1.3-A Evidence Registry & Reproduction Baseline candidate: stable evidence/gap IDs, 24 OP / 35 I / 16 event cross-index, reproduction rules and tooling-need decisions. Independent review/adoption pending. |

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
| S1.3 scope and conformance plan | [PR #18](https://github.com/Stahldavid/forge/pull/18), `801c2192e64652ade19a642b2f09f8660963c74f` | `ADOPTED`; S13-P08 complete; reviewed head `c694e9091bc1211b27d7e5e934ff4b9905e6ae89` |
| Delta semantic timeline test timeout/cleanup | [PR #20](https://github.com/Stahldavid/forge/pull/20), `92c470ae2319aed9bde734d4506767677abe5a3c` | Adopted separately; reviewed head `0c8fe25d65ff5619395f3cf1f24635ba99a8e34c`; test-only, no Agent Fabric semantic change |
| S1.3-A evidence/reproduction baseline | No adoption event | `IMPLEMENTATION_CANDIDATE`; documentary/evidence-only; S13-A12 pending |

The adopted architecture/evidence-planning baseline remains
`main@801c2192e64652ade19a642b2f09f8660963c74f`. The current repository/reproduction
baseline is `main@92c470ae2319aed9bde734d4506767677abe5a3c` after the separate PR #20
test-only repair; S13-A01 movement is assessed in the evidence catalog section 1.1.
S1.3-A remains unadopted and requires fresh final-head evidence/review. The P0a coordinates above
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

S1.3 evidence describes what was observed and how it can be reproduced. Evidence metadata,
a runner, a formal model or a signature cannot manufacture runtime authority or silently
change an `OP-*`/`I-*` obligation. The S1.3-A candidate may classify gaps and recommend a
future decision, but it cannot implement a repair/tool or erase a historical failed or
inconclusive observation.

## Scope boundary

The freeze does **not** declare the entire future Agent Fabric implemented or
production-ready. It distinguishes three categories:

- **ACCEPTED_P0A** — implemented, tested, independently reviewed, and merged;
- **FROZEN_DIRECTION** — architecture direction that later slices must respect but that
  is not fully implemented by P0a;
- **DEFERRED** — intentionally outside the accepted baseline and requiring a future slice
  and separate acceptance evidence.

S1.2 — Reference Implementation Design is adopted. S1.3 planning is also adopted and
limits its first implementation stage to **S1.3-A — Evidence Registry & Reproduction
Baseline**.

The S1.3-A candidate organizes existing evidence with stable IDs, separates historical
acceptance from current reproduction/source mapping, preserves `PASS`/`FAIL`/`SKIPPED`/
`NOT_APPLICABLE`/`BLOCKED`/`INCONCLUSIVE`, cross-indexes all 24 OP rules, 35 invariants and
16 persisted event families, defines exact-SHA reproduction discipline and classifies gaps.
An evidence gap may remain visibly open; it cannot be hidden by a broad green suite.

A generic conformance runner, formal model checking, proof/evidence signing, cross-language
or JCS conformance, machine-readable evidence automation, production retention, runtime/
schema/test/workflow/dependency/timeout changes and P0b are **not** authorized by S1.3-A.
Any later tooling or repair requires a separate objective, scope, exact-SHA evidence,
independent review and adoption.
