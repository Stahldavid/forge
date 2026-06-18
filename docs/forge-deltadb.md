# Forge DeltaDB Preview

Forge DeltaDB records the process between Git commits automatically.

When Forge commands or `forge dev` run, Forge writes a local operation log under `.forge/delta/`. The log captures Forge command completion, generated artifacts, manifest imports, runtime calls, file saves observed by the dev watcher, proofs, diagnostics, and lightweight Git metadata.

The recorder is ambient. Developers do not start or close work manually.

```bash
forge delta status
forge timeline
forge explain billing.createInvoice
```

## Local Store

H44 stores DeltaDB locally with PGlite at:

```text
.forge/delta/delta.db
```

The path is gitignored by default. It is local state, not a Git replacement and not a committed audit artifact.

## Privacy Defaults

DeltaDB stores names, paths, hashes, trace IDs, diagnostic codes, policy names, result states, durations, and summaries.

It does not store raw prompts, model outputs, full runtime response bodies, authorization headers, cookies, API keys, private tokens, or raw secret values by default. Payloads pass through the Forge telemetry scrubber so secret-like keys and known secret values are redacted before persistence.

## Commands

`forge delta status` shows whether recording is available, where the local store lives, the latest session, and recent operations.

`forge timeline` prints recent operations. It accepts a target and simple kind filter:

```bash
forge timeline src/policies.ts
forge timeline billing.createInvoice
forge timeline --kind proof.run
forge timeline --json
```

`forge explain <thing>` reconstructs the available operational context for a runtime entry, file, artifact, diagnostic, or manifest path:

```bash
forge explain billing.createInvoice
forge explain src/policies.ts
forge explain FORGE_POLICY_DENIED
```

## Scope

H44 is the local substrate. It intentionally does not include CRDT editing, multiplayer, cloud sync, a dashboard, a stacked PR system, or a replacement for Git.

