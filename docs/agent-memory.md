# Agent Memory

ForgeOS can ingest external coding-agent activity into local, redacted memory.

The bridge is opt-in. It normalizes Codex hooks, Claude Code hooks, Cursor MCP/rules events, and explicit imports into `forge.agent-event.v1` envelopes. Forge stores summaries, file paths, tool names, tool-call ids, safe command summaries, result status, hashes, and trace links. It does not store raw prompts, completions, tool arguments, tool responses, transcripts, cookies, authorization headers, API keys, or private tokens by default.

## Commands

```bash
forge agent onboard --target codex --json
forge agent install --target codex
forge agent install --target claude
forge agent install --target cursor
forge agent ingest codex --event UserPromptSubmit --input '{"hook_event_name":"UserPromptSubmit","session_id":"s1","turn_id":"t1","model":"test","prompt":"hello"}' --json
forge agent hooks status --target codex --json
forge agent hooks smoke --target codex --json
forge agent context --json
forge agent context --entry billing.createInvoice --json
forge agent context --change current --json
forge agent context --proof security-prove --json
forge agent context --handoff --json
forge agent memory --json
forge agent timeline --json
forge agent timeline --target codex --json
forge mcp serve
```

`forge mcp serve` exposes Forge context, memory, timeline, and inspect tools to MCP-compatible agents. The MCP surface is intentionally kept read/context oriented; ForgeOS does not duplicate mutating CLI workflows as new MCP tools during alpha hardening.

`forge agent onboard --target codex --json` is the recommended first command when an external agent enters a ForgeOS repo. It prepares the adapter files, records a smoke canary, runs the compact dev diagnostic cycle, and returns whether the agent is ready to edit.

`forge agent hooks status --target codex --json` checks whether the native hook bridge is installed, the local memory store is readable, and recent events contain useful signals. For Codex Desktop, installed hook files alone are not enough: Codex may show a trust prompt before running new hooks. Once ForgeOS can see a canary or useful hook event, status returns `approvalStatus: "accepted"` with `approvalRequired: false`; `nativeTrustStatus: "waiting-for-native-signal"` separately means a trusted native Codex event has not appeared yet.

`forge agent hooks smoke --target codex --json` records an explicit canary event and verifies that it becomes visible in local agent memory. The smoke JSON includes a `canary` block with the marker, source, ingested event id, number of memory events inspected, and whether the exact event is visible. A visible canary proves the ForgeOS ingestion path and DeltaDB memory store, so the local workflow can proceed. It does not prove native Codex Desktop provenance. If approval is still pending, approve the hooks in Codex Desktop, continue or start a Codex session in the same workspace, then run `forge agent hooks status --target codex --json` again.

Native hooks enqueue newline-delimited events in `.forge/agent/events.ndjson`. New Codex hook entries are written as redacted payloads: raw prompts, completions, tool arguments, tool responses, transcripts, cookies, authorization headers, API keys, and private tokens are not written to the queue. The watch ingester drains that queue from a checkpoint, keeps partial trailing lines for the next pass, and compacts consumed history into redacted `.history` lines so repeated status/smoke checks do not duplicate old hook events. If a hook status looks stale, inspect the checkpoint and history files only as local operational state; rerun status after Codex Desktop has approved hooks and emitted a fresh native event.

The queue checkpoint advances only after an event is stored. If DeltaDB is
temporarily busy because another Forge process is writing, the watcher backs off
and retries instead of marking the event consumed. This lets `forge dev` stay
running while Codex hook events continue flowing into Agent Memory.

`.codex/hooks.json` is the versioned Codex adapter configuration that tells Codex Desktop which ForgeOS hook commands may run in this workspace. Treat changes to that file like source changes: review them in PRs and keep them intentionally small. `.forge/agent/**`, including `events.ndjson`, checkpoints, history, canary markers, and exported context snapshots, is local operational state. Do not commit those files as proof of hook readiness; regenerate or reingest them with `forge agent hooks status --target codex --json` and `forge agent hooks smoke --target codex --json` when a machine or workspace needs fresh evidence.

`forge agent timeline --json` is the compact external-agent activity view. It reads redacted hook/MCP/import events, groups the visible sessions, files, entries, tools, proofs, and status signals, and returns an ordered event list for demos, handoffs, and agent-native UIs. Use `--target codex`, `--target claude`, or `--target cursor` to focus one provider.

`forge agent context --current --json` returns a compact context pack for external agents. It includes a `summary` with counts, sources, tools, and latest event time, plus goals, tool calls, files, entries, approvals, proofs, current session confidence reasons, and compact recent event metadata. Use `--entry <name>` for a runtime entry, `--change current` for the inferred current work session, `--proof <kind>` for proof freshness context, and `--handoff` when preparing a compact next-agent packet. Full normalized envelopes remain available through `forge agent memory --json` for explicit inspection.

Without `--json`, `forge agent context` and `forge agent memory` print compact terminal summaries instead of dumping full event payloads. Use human mode for quick orientation and `--json` when another tool needs the structured contract or detailed audit view.

If the local DeltaDB-backed memory store is unavailable, hook commands return structured JSON with `FORGE_AGENT_MEMORY_UNAVAILABLE` and repair commands instead of throwing raw runtime errors:

Agent memory reads are non-blocking: `forge agent timeline`, `forge agent context`, and memory list commands can read while another ForgeOS or agent process is recording events. Mutating operations such as ingest, hook smoke writes, timeline rebuild, session edits, and Delta repair still use the local writer lock and may return `FORGE_DELTA_BUSY` with retry guidance instead of appearing to hang. Busy responses include a `busy` object with the lock path, pid when known, process-alive signal, lock age, cwd, and command so agents can decide whether to wait, inspect, or repair.

```bash
forge delta status --json
forge delta repair --dry-run --json
forge delta repair --yes --json
forge agent hooks smoke --target codex --json
```

## Codex Hook Metadata

Codex command hooks send one JSON object on stdin. ForgeOS treats the raw hook
payload as sensitive and derives safe metadata from the documented Codex fields:

| Codex event | Useful fields Forge records |
|-------------|-----------------------------|
| `UserPromptSubmit` | prompt hash, prompt stored flag, session, turn, model, permission mode |
| `PreToolUse` | `tool_name`, `tool_use_id`, safe command summary/hash, inferred files and entries |
| `PermissionRequest` | requested tool, approval description summary, command hash, permission mode |
| `PostToolUse` | requested tool, result status, exit code, response hash/summary, inferred files and entries |
| `SubagentStart` / `SubagentStop` | subagent id/type and safe last-message metadata |
| `Stop` | safe last-assistant-message hash/summary and turn/session metadata |

For Bash and `apply_patch`, Forge derives metadata from `tool_input.command`.
For MCP tools, Forge derives metadata from the tool name and structured
arguments. The original `tool_input`, `tool_response`, prompts, and transcripts
are not persisted.

## Sources

| Source | Integration | Default |
|--------|-------------|---------|
| Codex | Hook installer and normalized event ingestion | Opt-in |
| Claude Code | Hook installer and MCP-friendly event ingestion | Opt-in |
| Cursor | MCP, rules, file observer, and Git observer setup | Opt-in |
| Import files | Explicit `forge agent ingest` inputs | Opt-in |

## Privacy Model

Agent memory uses the same redaction posture as DeltaDB:

- store stable identifiers, paths, hashes, timestamps, summaries, and safe metadata
- redact secret-like keys and known secret values
- avoid raw prompts, completions, transcripts, request bodies, tool arguments, and tool responses in both durable memory and the normal Codex hook queue path
- keep memory local unless the user exports or syncs it through a separate workflow

## Relationship To DeltaDB

DeltaDB records Forge operations and local development activity. Agent memory adds external-agent activity to the same work history. Semantic timelines can then connect a Forge command, a file change, a failed proof, an external agent tool call, and a later verification run into one navigable story.

Use [Forge DeltaDB](forge-deltadb.md) for the local operation log and [Agent Contract](agent-contract.md) for the generated project contract.
