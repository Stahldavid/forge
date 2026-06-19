# Agent Memory

ForgeOS can ingest external coding-agent activity into local, redacted memory.

The bridge is opt-in. It normalizes Codex hooks, Claude Code hooks, Cursor MCP/rules events, and explicit imports into `forge.agent-event.v1` envelopes. Forge stores summaries, file paths, tool names, tool-call ids, safe command summaries, result status, hashes, and trace links. It does not store raw prompts, completions, tool arguments, tool responses, transcripts, cookies, authorization headers, API keys, or private tokens by default.

## Commands

```bash
forge agent install --target codex
forge agent install --target claude
forge agent install --target cursor
forge agent ingest codex --event UserPromptSubmit --input '{"hook_event_name":"UserPromptSubmit","session_id":"s1","turn_id":"t1","model":"test","prompt":"hello"}' --json
forge agent context --json
forge agent memory --json
forge mcp serve
```

`forge mcp serve` exposes Forge context, memory, timeline, and inspect tools to MCP-compatible agents. The MCP surface reads local project context; it does not make imported memories executable runtime entries.

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
- avoid raw prompts, completions, transcripts, request bodies, tool arguments, and tool responses
- keep memory local unless the user exports or syncs it through a separate workflow

## Relationship To DeltaDB

DeltaDB records Forge operations and local development activity. Agent memory adds external-agent activity to the same work history. Semantic timelines can then connect a Forge command, a file change, a failed proof, an external agent tool call, and a later verification run into one navigable story.

Use [Forge DeltaDB](forge-deltadb.md) for the local operation log and [Agent Contract](agent-contract.md) for the generated project contract.
