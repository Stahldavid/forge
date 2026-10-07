# Workflow program v2 verification evidence

Date: 2026-10-07. Baseline: c8dfdf0c0c3cd6610bab68b4872ab9dcf8d4214c.
Release target: forgeos 0.1.0-alpha.70. The release workflow binds its exact pushed SHA.

## Scope established locally

Focused suites cover finite AST lowering and schema constraints, typed references,
80-item coverage/seals, owner-issued receipts, acceptance/candidate linkage, bounded
repair and restart, event targeting, barriers/generations, data-only completion,
immutable history, byte budgets and uncertain publication. Actual command-process
fixtures cover two independent files, three successive same-file deltas, diamond
composition, independently identical conflicting patches, authenticated owner
transport and concurrent apply idempotency. Existing v1 SDK tests are retained.

The initial strict framework TestGraph completed all 277 files/71 chunks with test
status pass. The overall verify invocation failed on stale generic/codex adapter
exports, which were then regenerated. Final release gates must be read from their
actual local/CI outcomes; that initial adapter failure is not represented as a pass.

## Independent implementation review

A read-only subagent independently reproduced and verified fixes for forged receipts,
input/result contracts, persistent counters, late worker outcomes, old additive gates,
failed repairs masked by trailing values, omitted item contributions, retired branch
ledgers and static-binding byte expansion. It ran 50 tests, then 6 focused delta tests,
with zero failures. No remaining reproduced blocker was identified in that scope.
This is implementation review of a bounded alpha, not complete plan/product acceptance.

## Real Codex SDK pilot

Started 2026-10-07T13:01:42.961Z; completed 13:02:22.229Z.
Model gpt-6.1-sol, one attempt, outcome completed, status completed.
Thread 01a11674-ab47-7b81-88b7-d5137124d19e.
A typed readonly activity returned the exact fixture answer fabric-v2-pilot; the source
input was unchanged. The reviewer inspected the persisted record, result artifact,
source and nine transitions without spending a second model call.
This does not establish SDK migration/review/application, production or App-closed
operation. Reproduction is explicitly opt-in:

    node --import tsx scripts/pilot-fabric-program-sdk.mjs --yes --model MODEL --output REPORT

## Bounded recovery benchmark

Three deterministic local runs: 80 items, concurrency four, two observed infrastructure
failures, owner close/reopen/resume. Every run produced 80 results in 82 adapter calls,
retaining 78 successful outputs. The pure fixture adapter explicitly attests reusable
inputs. A procedural reference also completed in 82 calls; it has no equivalent disk
journal, worker clones or models. The harness does not run Claude Code.

| Observed mean | Fabric | Procedural reference |
| --- | ---: | ---: |
| Full elapsed | 49.276 s | 0.164 s |
| Recovery elapsed | 29.333 s | not equivalent |
| Retained disk | about 58.7 MB | no durable journal |

There were 81 materialized operations and 897 transitions per Fabric run. These results
show significant persistence overhead and bounded recovery correctness, not speed
superiority, actual token/cost savings or maximum-scale acceptance.
Reproduction: node --import tsx scripts/benchmark-fabric-programs.mjs --output REPORT.

## Remaining acceptance

Independent live branch scheduling, semantic inventory, extensible recipe registries,
SDK output reuse, automatic GC, filesystem power-loss durability, maximum-scale tests,
full SDK coding workflow and comparison against actual Claude Code remain unestablished.
EasyGrow, production, human acceptance and native hook completion retain their earlier
separate gates. The release includes the executable example and contract documentation.

## Final local release gates

After regenerating the stale adapters, verify framework passed all 11 steps, with the
entire 277-file/71-chunk TestGraph, no skipped gates and elapsed 508.643 s. The warning
about PGlite RLS being structural is retained; Postgres authoritative proof belongs to
release CI. Focused v2+SDK suites passed 63 tests/210 expectations. After the separate
template dependency adjustment, template/audit policy suites passed 8 tests/47 expectations.

The eight-target dependency gate passed after overriding the Nuxt template's devtools
to 4.0.0-beta.4, removing its vulnerable simple-git dependency. An attempted simple-git
4.0.2 override passed audit but failed actual template typechecking because the old
consumer imported its removed default export; that attempt was discarded. The accepted
devtools adjustment passed real npm installation, generation, dev-once and smoke verification
including typechecking in a fresh Nuxt template. Existing two scoped, expiring high-severity
advisory exceptions were preserved, with no new exception. This is not a claim of zero
advisories across the generated Nuxt dependency graph.

The first packed-package smoke passed installation, CLI, repository maps, app generation/
verification, native hook runner smoke, studio open and wrapper scaffold. A second run
adds actual installed v2 DSL/example validation; its outcome and exact release CI SHA
are recorded in the user-facing delivery report after execution.

The final packed smoke passed, including importing the installed v2 authoring module
and lowering/validating the shipped five-step example against its registry. The local
package reported version 0.1.0-alpha.70. This smoke ran from an actual npm tarball,
not a dry-run or a source-only import.
