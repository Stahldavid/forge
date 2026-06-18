# Agent Memory

ForgeOS can ingest external coding-agent activity into local, redacted memory.

The bridge is opt-in. It normalizes Codex hooks, Claude Code hooks, Cursor MCP/rules events, and explicit imports into `forge.agent-event.v1` envelopes. Forge stores summaries, file paths, tool names, command names, hashes, and trace links. It does not store raw prompts, completions, tool arguments, transcripts, cookies, authorization headers, API keys, or private tokens by default.

## Commands

```bash
forge agent install --target codex
forge agent install --target claude
forge agent install --target cursor
forge agent ingest --source codex --input ./event.json --json
forge agent context --json
forge agent memory --json
forge mcp serve
```

`forge mcp serve` exposes Forge context, memory, timeline, and inspect tools to MCP-compatible agents. The MCP surface reads local project context; it does not make imported memories executable runtime entries.

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
- avoid raw prompts, completions, transcripts, request bodies, and tool arguments
- keep memory local unless the user exports or syncs it through a separate workflow

## Relationship To DeltaDB

DeltaDB records Forge operations and local development activity. Agent memory adds external-agent activity to the same work history. Semantic timelines can then connect a Forge command, a file change, a failed proof, an external agent tool call, and a later verification run into one navigable story.

Use [Forge DeltaDB](forge-deltadb.md) for the local operation log and [Agent Contract](agent-contract.md) for the generated project contract.
