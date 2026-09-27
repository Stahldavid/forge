# Fixed local adaptive harness slice

Status: implementation slice for delivery step 10, **not an adoption record**.
Target: one owner on one PC. No hosted model, API key, Codex model turn, shell
command, network call, file write, merge, deploy, or publish is performed by
this slice.

## Implemented boundary

`local-adaptive-harness.ts` compiles one versioned, code-owned workflow with
two data-only activity nodes (`inventory`, `constraints`) and one explicit
join. The only accepted worker inputs are strings of at most 256 characters.
The two profiles and their permitted tools are frozen in code. Inputs cannot
select an agent, harness, provider, tool, command, network destination, or
execution profile. The worker calculation is a deterministic digest; it is a
protocol rehearsal, not an AI coding task.

The local CLI wrapper (`forge fabric adaptive-*`) records an owner-reviewed
proposal, optionally binds a selected Evolution data-profile version, commits
P0a permits to local PGlite before process dispatch, and persists a bounded
result. `adaptive-status` reads the authoritative join after restart without
rerunning workers. A crash after dispatch without a committed join is uncertain
and requires a fresh owner-approved proposal for another attempt.

The existing P0a Conductor remains the authority for transitions. The harness
requires the exact active plan and a coordinator grant authorized for one
join and two child attempts. Each child receives a derived grant with one
attempt, depth zero, one reserved worker unit, a single source/target,
`read` effect only, and a bounded expiry. Claims and permits are leased for
1,000 ms. The join is committed as an authoritative outcome only after both
child outcomes are authoritative successes with the expected intent, permit,
and deterministic result digest. Missing, failed, stale, or unexpected child
results do not create a join outcome.

Focused tests cover two successful children and join, expired lease,
insufficient parent attempt budget, a failed child, and oversized input.

## Limits before step 10 can be adopted

- This module computes the two results in its caller process. Its compiled
  `process` execution profile is intended for a future worker adapter; this
  slice does not launch or isolate processes and does not prove runtime wall
  time, CPU, or memory enforcement.
- The CLI can rebind exact committed permits in a fresh Conductor for its one
  dispatch, but it never resumes workers after a crash. Recovery beyond
  authoritative readback, retries, and concurrent-host behavior remain outside
  this slice. The direct harness object remains in-memory.
- Grant creation and intent dispatch are separate P0a transitions. A failure
  during preparation can leave a reserved child grant without a matching
  worker. Adoption requires transactional orchestration or explicit cleanup
  and reconciliation.
- No repository context, model output, code patch, real worker process,
  local Docker sandbox, owner acceptance, or effect broker is connected here.
  Those require the separate step 8/9 boundaries and an end-to-end gate.

This slice should be integrated only through a trusted local owner service.
It must not be exposed as an MCP approval or arbitrary execution tool.
