# Agent Fabric single-owner local acceptance

Status: candidate. This record tracks the one-PC, one-owner target selected for
the current delivery. An exact-head CI result, a fresh real Ollama/Docker run,
and an owner decision through the final popup are required before calling the
pilot accepted. Package publication is a separate release gate.

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
| 0 Release integrity | Public `forgeos@0.1.0-alpha.64` was read back; this change has a patch changeset. | The next package must pass its own exact-head release and public readback. |
| 1-4 Contract, CLI, control, approval | Bounded task contract, owner-scoped PGlite journal, CLI and local popup. | Delegated popup decisions were observed on a disposable fixture; exact-head release confirmation remains. |
| 5-6 Worker and assurance | P0a permit-bound local Ollama call, isolated checkout, patch digest, status/readback, and separate diff acceptance. | Real local model and Docker checks passed; ambiguous dispatch never means success. Model quality outside the fixed fixture is not established. |
| 7 Agent clients | CLI and proposal/status/evidence MCP adapter share one local owner; two independent stdio clients were exercised. | A native Codex App MCP call in the current app session is still unobserved. MCP cannot approve or run. |
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

## Final evidence to record

1. Candidate Git commit, tree, PR and required CI/security check results.
2. Focused tests, TypeScript and lint, Forge generation/check, and framework
   verification result, including any machine-specific blocker.
3. Real keyless Ollama patch, Docker verification, restart readback, and a
   two-client MCP proposal/status/evidence run on that exact candidate.
4. Popup approval and diff decision in the final local flow, with the decision
   actor recorded. The delegated disposable-fixture clicks above cannot be
   described as independent human review.
5. Merged release PR, npm `alpha` dist-tag and installed-package smoke if this
   candidate is published.

This record is a gate checklist, not a claim that every broader Agent Fabric
architecture capability has been adopted.
