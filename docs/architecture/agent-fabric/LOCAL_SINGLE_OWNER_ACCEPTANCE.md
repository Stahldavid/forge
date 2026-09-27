# Agent Fabric single-owner local acceptance

Status: accepted for the bounded one-PC, one-owner local pilot on 2026-09-28.
The exact-head checks, real Ollama/Docker run, delegated popup decisions on a
disposable fixture, and public package readback passed. Native Codex Desktop
MCP calls and hook events remain unobserved in this app session, so this is
not acceptance of that integration or of the broader multiuser architecture.

## Product boundary

Codex App and other MCP clients can submit a bounded proposal and read status
and evidence through a running `forge fabric serve` owner. The owner reviews
and runs it through the CLI. The default worker is local Ollama; Forge applies
only an allowlisted text patch in an isolated Git checkout. The approved checks
use fixed Git/Docker descriptors. No hosted API key, paid coding-agent turn,
arbitrary tool, Git push, merge, deploy, or publish is available to that worker.

The local popup is a cooperative owner interaction. It does not separate the
owner from another program with unrestricted shell and UI access in the same
Windows account. The trusted-repository scope and fixed data workers are not a
general sandbox for adversarial source code or external agent executables.

## Delivery coverage

| Plan step | Local implementation | Acceptance limit |
| --- | --- | --- |
| 0 Release integrity | [Implementation PR #61](https://github.com/Stahldavid/forge/pull/61) merged at `6fb76d734257d96d1d366528848801cbd3698395`; [release PR #62](https://github.com/Stahldavid/forge/pull/62) merged at `3801303e0fbbd011610f21173b8260e0cd046a38`. The [publish run](https://github.com/Stahldavid/forge/actions/runs/36356759977) passed, npm `alpha` resolved to `forgeos@0.1.0-alpha.65`, and an isolated registry install reported the same CLI version. | The npm `latest` tag remains `0.1.0-alpha.33`; the workflow skipped its optional promotion because `NPM_TOKEN` is absent. |
| 1-4 Contract, CLI, control, approval | Bounded task contract, owner-scoped PGlite journal, CLI and local popup. Delegated popup decisions were observed on a disposable fixture. | Those clicks were made by the agent under explicit user delegation, not by an independent human reviewer. |
| 5-6 Worker and assurance | P0a permit-bound local Ollama call, isolated checkout, patch digest, status/readback, and separate diff acceptance. | Real local model and Docker checks passed; ambiguous dispatch never means success. Model quality outside the fixed fixture is not established. |
| 7 Agent clients | CLI and proposal/status/evidence MCP adapter share one local owner; two independent stdio clients were exercised. The CLI was called successfully from Codex Desktop. | A native Codex App MCP call and native hook event in the current app session are still unobserved. MCP cannot approve or run. |
| 8 Effects and sandbox | Fixed patch and Docker verification paths use durable intents, inspectable receipts, and fail-closed reconciliation. | No arbitrary consequential effect broker or OS sandbox for coding agents is adopted. |
| 9 Context and memory | Source snapshot checks, bounded private owner memory, deletion, and proposal binding. | Memory is untrusted context, never authority. No shared multiuser memory. |
| 10 Adaptive harness | Owner-reviewed fixed two-process digest workflow with attenuated P0a child permits and durable join readback. | These are data workers, not multiple general coding agents; a crash before committed join remains uncertain. |
| 11 Evolution Registry | Immutable versioned, fixed-schema data profiles; fixed evaluation and owner canary/promotion/revocation. | No executable extension or autonomous self-promotion. |
| 12 Multiuser production | Outside the selected one-PC target. | Requires separate identity, tenant, storage, operations, and security gates. |

## Local acceptance evidence

- A real `qwen2.5-coder:3b` run changed only `answer.txt: alpha -> beta` in an
  isolated checkout. `git diff --check` and the fixed Docker Node check passed.
  Reopening the owner returned the same evidence digest without another model
  call. A separate two-client MCP smoke observed one owner across a restart and
  made zero model calls.
- The pinned-model disposable task `task:17e2370c2ba46d38e2437a38d098f92ef2ec3aea5be77107073add81c7eb0736`
  was approved, run, and its diff `sha256:0ace9a0bec6340fcb7273627a2b8a73600dcc94c48014067000e36057ef22e2a`
  accepted through two Chrome popup decisions. The user explicitly delegated
  these clicks to the agent. Restart readback reported `accepted` and the
  pinned model `qwen2.5-coder:3b`. This proves the UI decision path, but does
  not establish an independent human decision for this fixture.
- The approved model ID is part of the new proposal digest and owner popup.
  Old proposals without that field retain their stored digest, report
  `model: null` in provenance, and cannot initiate a new model call from an
  unused approval. A new proposal and decision are required after a model
  change.
- Two earlier owner-approved `qwen3:0.6b` attempts returned malformed file
  proposals. The original remains `patch_uncertain` due to the pre-fix effect
  ordering; its isolated checkout was never created. The second committed a
  definitive `model_failed` outcome without a patch intent or retry. Neither
  attempt was replayed. The fixed worker now validates before committing a
  successful result or beginning patch materialization.

## Release and acceptance evidence

1. Implementation candidate `b02211895c77d7e5201435b4ac737aaee7603fed`
   passed seven exact-head PR checks, including CI, security, Nuxt, Windows,
   Linux, quickstart, and GitGuardian. Independent security review found a
   model-pinning issue; the candidate fixed it and follow-up review found no
   actionable issue. The release PR head
   `eeeb1745ca06e8ab68cb0a719fced870ea319a94` also passed seven checks.
2. Local focused model-pinning tests passed 30/30. TypeScript, lint, Forge
   generation/check, and framework verification passed on the implementation
   candidate. The real keyless `qwen2.5-coder:3b` fixture changed only
   `answer.txt: alpha -> beta`, passed `git diff --check` and the fixed Docker
   Node check, and preserved its evidence digest after owner restart. Two MCP
   stdio clients read the same owner across a restart without model calls.
3. The final popup approval and diff decision were clicked by the agent under
   explicit user delegation on a disposable fixture. The persisted task is
   `accepted` with pinned model `qwen2.5-coder:3b` and diff digest
   `sha256:0ace9a0bec6340fcb7273627a2b8a73600dcc94c48014067000e36057ef22e2a`.
   This does not establish independent human review.
4. The publish workflow passed after the release merge. `npm view` resolved
   `forgeos@alpha` to `0.1.0-alpha.65`; a fresh temporary npm install executed
   its own `forge --version` and returned `0.1.0-alpha.65`.
5. The current Codex Desktop tool list contains no exposed `fabric_*` MCP
   tools, and `forge agent onboard --target codex --json` reports zero native
   hook signals. Native Codex Desktop integration requires a separate observed
   call and event before it can be called accepted.

This is acceptance of the bounded local pilot. It is not a claim that arbitrary
coding agents, an OS sandbox, native Codex Desktop integration, or multiuser
production have been delivered.
