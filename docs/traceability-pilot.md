# Deterministic traceability pilot

The pilot exercises the implementation in disposable local repositories and DeltaDB stores. Writer, reviewer and checker are distinct deterministic command processes. Agent Memory events are sanitized fixture imports. Git commits belong only to these repositories. No real project hook, model/provider, push or deployment is activated.

The cooperative command adapter truthfully advertises its host-network capability. The pilot supplies an OS network namespace containing only loopback and no routes. The runner verifies this boundary before doing work. This validates isolation for the pilot; it does not claim that the cooperative adapter itself blocks network access.

## Reproduce

Use a checkout with installed frozen dependencies, Node >=22.14, Bun, Git, Linux `unshare` and `ip`. Set an absolute path to the previously preserved alpha.72 `program-store.ts` and to the actual Node executable. The pilot never downloads or installs an old runtime.

```sh
export FORGE_FABRIC_TEST_MODE=1
export FORGE_SMOKE_REAL=0
export FORGE_TRACE_NODE="$(command -v node)"
export FORGE_TRACE_LEGACY_SOURCE=/absolute/preserved/forgeos/src/forge/agent-fabric/program-store.ts
unshare -Urn python3 -c 'import subprocess,os;subprocess.run(["ip","link","set","lo","up"],check=True);os.execvp("node",["node","--import","tsx","scripts/traceability-pilot.ts","--output","/absolute/new-pilot-output"])'
```

The runner clears provider keys, disables external Git configuration/hooks, sets fixture mode and disables background queue drains. It runs the nine trace suites and the existing Agent Memory H48 suite, preserving JUnit and console receipts. A nonzero test result stops positive evidence capture.

The trace CLI suite launches the actual `bin/forge.mjs` entrypoint from disposable fixture directories with recording enabled and without `--no-delta`. It checks absent stores, failed queries, active brokers, offline existing databases, candidate/file filtering and superseded corrections. This exercises post-command recording as well as the query handler; library-only checks are insufficient for the no-initialization guarantee.

It then produces a positive explanation, typed metadata CAS, source ancestry readback, exact-edge oracle and `pilot.json`. The independent verifiers read the atomic envelope and JSON CAS bytes, recompute hashes, follow committed journal/state ancestry and metadata children, and derive expected endpoints directly from source artifacts. The nine predicate categories contain ten exact edges in the standard fixture. The Git controller separately verifies expected public file bytes, modes, parent and absence of outside changes. Provenance and authority assertions are separate from endpoint comparison.

Thirty actual no-op Fabric projection passes record source reads and latency. The runner records separate Fabric CAS/journal/envelope and Delta file sizes before removing its own fixture. A repeated run needs a new output directory. No raw database or source snapshot is exported by default.

The context-pack suites also exercise historical source validity, exact entry/proof file bindings, identity and cut pinning, corrections, bounded reads, unavailable brokers, and the real CLI handoff consumer. The new trace helper must not mutate fixture storage; the existing Agent Memory refresh lifecycle is tested separately.

## Scenario map

Paths below are relative to `tests/`. Each scenario records the layer exercised; a unit/synthetic fixture is not an operational acceptance claim.

| ID | Executed contract and principal evidence |
| --- | --- |
| T01 | `agent-fabric/trace-integration.test.ts`: real fixture commands, reviewed candidate, gate, apply and Git; `scripts/traceability-pilot-oracle.ts`: exact source-derived endpoints |
| T02 | Integration unchanged-cut replay plus `delta/trace-projection.test.ts`: atomic ledger replay; runner records zero new suffix versions |
| T03 | Delta distinct occurrence tests and Fabric distinct annotation request IDs with equal payload |
| T04 | Delta same-occurrence digest conflict preserves prior checkpoint and rows |
| T05 | Delta full runKey isolates colliding run IDs across stores; multi-run benchmark also stresses local entity ID reuse |
| T06 | `agent-fabric/trace-crash.test.ts`: kill owned reader/projector process after committed Fabric source, before projection; retry does not execute source |
| T07 | Crash suite kills Node after an actual uncommitted transaction; restarted broker has no partial batch/cursor |
| T08 | Crash suite kills after confirmed commit, before acknowledgment; retry preserves cardinality |
| T09 | `trace-fabric.test.ts`: mismatched cursors, forged/truncated ancestry and orphan roots; bounded source errors |
| T10 | Integration pins a cut, mutates that run and creates another after inventory; first pass excludes changes, next includes them |
| T11 | Integration late Agent Memory stays pending until explicit verified annotation without reopening the run |
| T12 | Fabric rejects missing, wrong-session and wrong-namespace primary sources; H48 fallback trust remains explicit |
| T13 | Integration removes only a fixture primary event row after broker close; historical binding survives and primary becomes `source-expired` |
| T14 | Integration unavailable sink cannot dispatch or mutate source; existing Delta store tests cover occupied-writer boundaries |
| T15 | `trace-extractor.test.ts`: independent candidate/context changes preserve history and invalidate current evidence in full and incremental extraction |
| T16 | Crash suite uses real publisher boundaries after first file and all bytes; existing `program-v2-process.test.ts` preserves external edits; reconciled receipt is tied to actual committed journal |
| T17 | Integration confirms apply without creating a commit, then verifies `not-observed` Git state |
| T18 | `trace-git.test.ts`: identical content under another parent/run does not establish causal integration; integration retains pre-run outside dirt after later cleanup |
| T19 | Git suite detects outside-scope changes and limits whole-commit claims |
| T20 | Git suite covers dirty worktree, staged/partial state and partial commit evidence |
| T21 | Git suite observes merge parents and squash/cherry-pick-like structural cases without inferring method or transporting approval |
| T22 | Git suite handles missing/corrupt objects, full OID and object formats, promisor repos and unsupported transformations |
| T23 | Fabric typed closure rejects foreign run/store references and intact orphans; explicit reachability/depth/byte budgets |
| T24 | Fabric terminal annotation matrix includes applied/canceled/uncertain states and changed-body replay conflict; integration compares operational fields |
| T25 | Fabric format3/format4 read/write matrix; integration invokes the preserved old source for read/list/mutate and compares unchanged bytes |
| T26 | Integration rebuilds fresh projection with unchanged memory; synthetic benchmarks independently compare all ledger/entity/relation hashes |
| T27 | Delta generation activation tests and rebuilds preserve prior generation until explicit atomic switch |
| T28 | Fabric and Delta allowlist/redaction/path tests; Git filter-marker test; benchmark exact-known-canary scans of exports and closed fixture bytes |
| T29 | Existing `agent-memory/h48-agent-memory.test.ts`: partial/rotated queues, fallback, idempotent replay and serialized concurrent drains |
| T30 | Fabric/Delta/integration absent-store reads create no database or owner; `trace-cli.test.ts` exercises the complete CLI lifecycle with recording enabled, including failures, active brokers and byte-preserved offline databases |

T06 proves process crash/restart around projection, rather than killing a running writer. T16 uses an equivalent persisted intent fixture and the real publisher, rather than injecting a crash seam into the full service. These tests do not simulate power loss, filesystem hardware failure or native hooks. Reachability validation follows typed committed edges rather than arbitrary references embedded in summaries.

## Eliminatory criteria

| ID | Acceptance evidence |
| --- | --- |
| C01 | Declared positive denominator: nine predicate categories and ten exact source-derived edges, all endpoints matched; independent source and Git checks |
| C02 | Provenance remains declared/observed/inferred as contracted; all trace authority is none; host declaration remains declared |
| C03 | Full runKey and generation isolation, including collisions and local IDs reused by multiple runs |
| C04 | Same occurrence replay inserts zero; equal distinct occurrences remain distinct |
| C05 | Actual before/after-commit process interruption and restarted source/broker readback |
| C06 | Independent full/incremental context changes invalidate approval while retaining historical evidence |
| C07 | Exact object/scoped verification and negative Git cases; no causality inferred from content |
| C08 | New/old runtime matrix and unchanged bytes after old-reader rejection |
| C09 | Fixture-only writes, unchanged original checkout receipt, preserved Agent Memory during rebuild |
| C10 | Known canary rejection and export/storage scans; assurance limited to examined channels and known markers |
| C11 | Read-only library and real CLI behavior without `--no-delta`, active/offline broker preservation, target-scoped Git summaries, declared superseded corrections, explicit partial pages, limits and source availability |

## Benchmarks and limits

`node --import tsx scripts/traceability-benchmark.ts --output /absolute/new-benchmark.json` measures catalogs of100,1,000 and10,000 occurrences, each with30 warm query/status/replay samples. It records first calls separately, initial projection throughput, two-generation storage and an independent algebraic oracle comparing all source/entity/edge hashes. Warm query latency covers a bounded128-fact page, not an entire graph. The default benchmark uses one run per volume.

`scripts/traceability-incremental-benchmark.ts` adds a single catalog with multiple runs, independent complete paginated readback/rebuild and30 genuinely new one-occurrence batches per run. Report the base catalog size and its growth during measurement. New writes, replay and full rebuild are separate costs. Both scripts support a small `--smoke` mode which is never substituted for full-volume results.

Run these scripts inside the same network namespace. Do not infer a production SLO, end-to-end agent productivity, cache-cold operating-system behavior or byte-identical database housekeeping from these measurements. Known canary scans are not proof of universal absence of secrets.

The final execution report must separately list pilot results, selected existing regressions, static checks and any full framework timeout/failure. A checks-only framework pass does not establish that the entire repository test graph passed. Generated artifacts and exported adapters are environment-dependent and must be preserved as validation receipts, then excluded from the implementation patch according to this repository's instructions.
