# Local consequential effect broker: bounded reference slice

Status: implementation candidate. This file does not adopt step 8 of the
[coding-agent delivery plan](CODING_AGENT_DELIVERY_PLAN.md) as complete.

## Contract and authority

`LocalEffectBroker` has one effect kind: `immutable_local_artifact_v1`. Its
request contains a task identity, a subject digest, and at most 4 KiB of UTF-8
content. The caller cannot provide an output path, executable, URL, Git remote,
image, or command. The broker derives a filename from the canonical request
digest below the trusted repository's `.forge/local/agent-fabric/effects/`
directory. It rejects extra fields and every other effect kind, including
shell, network, Git push, package publication, merge, and deployment.

Trusted local owner ingress must supply an `ownerId`, expiry, and proof for the
exact challenge. The verifier is a constructor dependency; an MCP proposal or
model output cannot instantiate a trusted verifier. The challenge gives the
owner UI the exact request, repository root, derived target, content digest,
and expiry. The authorization digest persists without the raw proof.

The broker is a single-process, single-owner PGlite component. It does not
defend against another process with unrestricted write access to the same OS
account, database, or repository. Its path checks reject pre-existing symbolic
links but do not eliminate a same-account path-swap race.

## Dispatch and reconciliation

1. Validate the fixed request and resolve the trusted destination.
2. Verify the owner proof against the exact challenge and expiry.
3. Persist a unique `intent` row in PGlite before opening the artifact.
4. Create the derived file with exclusive creation, write bounded bytes, and
   sync its file handle.
5. Read the file independently and compare its digest to the resolved bytes.
6. Persist a receipt digest only after the readback matches.

An identical request can observe an existing intent but never dispatch it
again. `inspect` and `reconcile` perform a fresh disk read. An intent with no
file is `receipt_unknown`; an incomplete file is
`incomplete_materialization`; a matching file without a committed receipt is
`materialized_without_receipt`; a missing or changed file after receipt is
`receipt_mismatch`. None is success, and reconciliation never retries a write
or fabricates a receipt. A committed receipt whose file still matches is
`receipted`. These states separate acknowledgment from observation after a
process crash.

## Evidence and limits

The focused test covers scope rejection, wrong owner/challenge/expiry, changed
request replay, receipt integrity, and injected crashes after intent, file
open, write, readback, and receipt. It uses actual PGlite and a local filesystem.

This slice does **not** yet wrap the task service's Git patch materialization,
Docker verification, checkout creation, or other Agent Fabric effects. The
fixed artifact demonstrates the broker chain while those integrations need
their own trusted request types, target confinement, approval binding, crash
recovery, and explicit adoption evidence. A matching file after an interrupted
write is intentionally not promoted to success without a committed receipt.

The local task service separately records a patch materialization intent before
its fixed Git worktree effect. On interruption it exposes `patch_uncertain` and
an explicit read-only `fabric reconcile` path that checks the checkout against
the committed model result before recording a receipt. This service path is not
yet implemented through `LocalEffectBroker`; the broker's fixed artifact remains
a reference for other consequential effect kinds.
