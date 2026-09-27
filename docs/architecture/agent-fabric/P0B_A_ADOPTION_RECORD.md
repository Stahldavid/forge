# P0b-A — Adoption Record

**Record ID:** `AF-P0B-A-ADOPTION-2026-09-27`

**State recorded:** `ADOPTED` on 2026-09-27. This records the completed PR #52 merge;
it does not create a second adoption or authorize P0b-B.

## Exact coordinates

| Coordinate | Value |
| --- | --- |
| Planning scope | [PR #46](https://github.com/Stahldavid/forge/pull/46), merged as `490c2b54a2a354cb38b0f527c6a3f9372f703ff5` |
| Runtime implementation | [PR #52](https://github.com/Stahldavid/forge/pull/52) |
| First merge parent | `dd379c44dd6d608c183ab30b3381d229f777b5c4` |
| Independently reviewed head / second merge parent | `ec37aeaa1c293d63e98de0b523fc2815761bc3dd` |
| Adoption merge on `main` | [`de3e1d5c97448823792bac1fcb71ab16e877ebab`](https://github.com/Stahldavid/forge/commit/de3e1d5c97448823792bac1fcb71ab16e877ebab) |
| Merged at | `2026-09-27T13:08:49Z` |
| Reviewed and merged tree | `2287a96ea7f4ed945f37fcfb7ceb681cd0dcff67` |

The merge has the reviewed head as its second parent and the same tree. The repository's
protected `main` required the `verify`, external quickstart, six Node/OS smoke and
`security-gate` checks with strict up-to-date branch enforcement at merge time. Issue
[#44](https://github.com/Stahldavid/forge/issues/44), the repository enforcement prerequisite,
was closed before this implementation was adopted.

## What was adopted

P0b-A adds one model-only text-generation adapter behind the accepted P0a conductor,
dispatch intent, permit and result boundary. The [implementation description](./P0B_A_MODEL_ADAPTER.md)
specifies the exact context/materialization/run-spec digest chain, finite request/result/
token/time bounds, one physical request, no hidden SDK retry or redirect, conservative
uncertainty, non-authoritative model output and replay without provider callbacks.

The original planning record named hosted providers. The operator declined API-key use and
explicitly authorized a local Ollama extension on 2026-09-27. The adopted resolver fixes
Ollama to loopback `http://127.0.0.1:11434/v1`, does not read a secret for it and binds the
installed model to the authorized target. This is not a general custom-endpoint capability.

## Exact-head evidence

- [CI run 36320666149](https://github.com/Stahldavid/forge/actions/runs/36320666149),
  [Security Assurance run 36320666197](https://github.com/Stahldavid/forge/actions/runs/36320666197)
  and [Nuxt Template Smoke run 36320666179](https://github.com/Stahldavid/forge/actions/runs/36320666179)
  completed successfully on reviewed head `ec37aeaa…`. CI included the required `verify`,
  six Node/OS smokes and external quickstart jobs.
- Nine focused deterministic P0b-A tests passed, including the 429 and redirect vectors
  that prove one physical request and the keyless fixed-endpoint Ollama path.
- A real local Windows smoke ran from a clean checkout at `ec37aeaa…` through the
  conductor/adapter path with Ollama `0.34.4` and installed `qwen3:0.6b`. It reported
  `status=passed`, authorized target `target:ollama:qwen3:0.6b`, effect
  `bounded_external_inference`, `physicalRequests=1`, a result digest and
  `replayWithoutProviderCallback=true`. The structural report contained no prompt,
  response text or secret value. The model digest was
  `7df6b6e09427a769808717c0a93cadc4ae99ed4eb8bf5ca557c90846becea435`.
- Independent review of the exact final head reported zero unresolved BLOCKER, HIGH or
  MEDIUM findings. Earlier redirect and dirty-checkout findings were repaired before that
  final review. The operator authorized the merge after the evidence was presented.

These observations establish a bounded real-provider invocation, not the factual
correctness of generated text, crash-safe exactly-once execution, or production readiness.

## Preserved boundary

P0b-A does not authorize model-selected tools, plugins, child delegation, consequential
target mutation, arbitrary outbound endpoints, adaptive routing, persistent governed
memory, production persistence/recovery or P0b-B. PR
[#10](https://github.com/Stahldavid/forge/pull/10) remains a separate open npm-release
candidate; adopting P0b-A did not authorize publishing `forgeos@0.1.0-alpha.64`.
