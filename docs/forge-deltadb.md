# Forge DeltaDB Preview

Forge DeltaDB records the process between Git commits automatically.

When Forge commands or `forge dev` run, Forge writes a local operation log under `.forge/delta/`. The log captures Forge command completion, generated artifacts, manifest imports, runtime calls, file saves observed by the dev watcher, proofs, diagnostics, and lightweight Git metadata.

The recorder is ambient. Developers do not start or close work manually. Forge also infers work sessions from the raw operation stream, so related file changes, runtime calls, diagnostics, proofs, manifest imports, agent tool calls, and Forge commands are grouped automatically.

```bash
forge delta status
forge timeline
forge explain billing.createInvoice
forge timeline --session current
forge explain session current
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

`forge delta status` shows whether recording is available, where the local store lives, the current inferred work session, the latest recorder session, and recent operations. A recorder session is the technical command/dev process that wrote operations. A work session is the H45 projection that groups related operations into human-readable work.

`forge timeline` prints recent operations. It accepts a target and simple kind filter:

```bash
forge timeline src/policies.ts
forge timeline billing.createInvoice
forge timeline --kind proof.run
forge timeline --session current
forge timeline --session worksess_...
forge timeline --json
```

`forge explain <thing>` reconstructs the available operational context for a runtime entry, file, artifact, diagnostic, or manifest path:

```bash
forge explain billing.createInvoice
forge explain src/policies.ts
forge explain FORGE_POLICY_DENIED
forge explain session current
```

`forge session` exposes optional correction commands for advanced workflows. These commands are not required in the normal loop; they exist to rename or repair inferred grouping when deterministic scoring is uncertain.

```bash
forge session list
forge session show current
forge session rename current "Import billing external service"
forge session merge current worksess_...
forge session split current op_...
forge session detach op_...
```

## Work Session Inference

H45 uses deterministic scoring. It does not call an LLM while assigning operations to sessions.

Signals include:

- time proximity
- same actor
- same Git branch
- same runtime entry
- same manifest service
- same file cluster
- diagnostic repair chain
- proof after related change
- shared trace ID

Scores at or above `0.65` attach as primary evidence. Scores from `0.40` to `0.64` attach weakly and mark the session as `needs-review`. Lower scores create a new work session. Sessions become `idle` after roughly two hours of inactivity and can be reopened if a strongly related operation appears.

Summaries are template based and redaction-safe. They use paths, entry names, diagnostic codes, proof kinds, and command names; they do not store raw prompts, raw model outputs, cookies, authorization headers, or full runtime bodies.

## Scope

H44 is the local recorder substrate. H45 is the inferred work-session projection over that substrate. This intentionally does not include CRDT editing, multiplayer, cloud sync, a dashboard, a stacked PR system, or a replacement for Git.
