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

This path is a PGlite/Postgres data directory, not a single SQLite file. The path is gitignored by default. It is local state, not a Git replacement and not a committed audit artifact.

## Privacy Defaults

DeltaDB stores names, paths, hashes, trace IDs, diagnostic codes, policy names, result states, durations, and summaries.

It does not store raw prompts, model outputs, full runtime response bodies, authorization headers, cookies, API keys, private tokens, or raw secret values by default. Payloads pass through the Forge telemetry scrubber so secret-like keys and known secret values are redacted before persistence.

## Commands

`forge delta status` shows whether recording is available, where the local store lives, the current inferred work session, the latest recorder session, and recent operations. A recorder session is the technical command/dev process that wrote operations. A work session is the H45 projection that groups related operations into human-readable work.

`forge timeline` prints the H47 Semantic Timeline projection. It is not the source of truth; it is a rebuildable view over the local operation log, inferred work sessions, runtime calls, proofs, diagnostics, artifacts, and Git mappings.

```bash
forge timeline src/policies.ts
forge timeline billing.createInvoice
forge timeline policy:billing.manage
forge timeline diagnostic:FORGE_POLICY_DENIED
forge timeline proof:security-prove
forge timeline --kind proof.passed
forge timeline --session current
forge timeline --session worksess_...
forge timeline rebuild
forge timeline --json
forge timeline billing.createInvoice --json --for-agent
```

Semantic timelines group raw operations into entity-oriented events such as `imported`, `generated`, `denied`, `policy.changed`, `executed`, `proof.passed`, `proof.failed`, `diagnostic.emitted`, and `git.exported`. Each event is linked to entities like runtime entries, files, policies, diagnostics, external services, proofs, dependencies, sessions, and Git commits. Timeline edges record causal hints such as a diagnostic likely being fixed by a policy change and then validated by a successful runtime call.

The projection can be rebuilt at any time:

```bash
forge timeline rebuild
```

Rebuild deletes and recreates `timeline_events`, `timeline_entities`, and `timeline_edges` from the durable operation log. This keeps the timeline aligned with event-sourcing principles: operations remain primary, while the semantic timeline is a queryable materialized view for humans and agents.

`forge explain <thing>` reconstructs the available operational context for a runtime entry, file, artifact, diagnostic, proof, policy, or manifest path. When Semantic Timeline data exists, explain uses it for current state, proof freshness, and recent causal context:

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
