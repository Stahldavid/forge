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
| 1-4 Contract, CLI, control, approval | Bounded task contract, owner-scoped PGlite journal, CLI and local popup. | Final popup decision and crash/replay evidence still need exact-head confirmation. |
| 5-6 Worker and assurance | P0a permit-bound local Ollama call, isolated checkout, patch digest, status/readback, and separate diff acceptance. | Model quality and owner acceptance must be observed on a real fixture; ambiguous dispatch never means success. |
| 7 Agent clients | CLI and proposal/status/evidence MCP adapter share one local owner; two independent stdio clients were exercised. | A native Codex App MCP call in the current app session is still unobserved. MCP cannot approve or run. |
| 8 Effects and sandbox | Fixed patch and Docker verification paths use durable intents, inspectable receipts, and fail-closed reconciliation. | No arbitrary consequential effect broker or OS sandbox for coding agents is adopted. |
| 9 Context and memory | Source snapshot checks, bounded private owner memory, deletion, and proposal binding. | Memory is untrusted context, never authority. No shared multiuser memory. |
| 10 Adaptive harness | Owner-reviewed fixed two-process digest workflow with attenuated P0a child permits and durable join readback. | These are data workers, not multiple general coding agents; a crash before committed join remains uncertain. |
| 11 Evolution Registry | Immutable versioned, fixed-schema data profiles; fixed evaluation and owner canary/promotion/revocation. | No executable extension or autonomous self-promotion. |
| 12 Multiuser production | Outside the selected one-PC target. | Requires separate identity, tenant, storage, operations, and security gates. |

## Final evidence to record

1. Candidate Git commit, tree, PR and required CI/security check results.
2. Focused tests, TypeScript and lint, Forge generation/check, and framework
   verification result, including any machine-specific blocker.
3. Real keyless Ollama patch, Docker verification, restart readback, and a
   two-client MCP proposal/status/evidence run on that exact candidate.
4. Human owner approval and diff decision in the final local popup. A synthetic
   approval test cannot substitute for this observation.
5. Merged release PR, npm `alpha` dist-tag and installed-package smoke if this
   candidate is published.

This record is a gate checklist, not a claim that every broader Agent Fabric
architecture capability has been adopted.
