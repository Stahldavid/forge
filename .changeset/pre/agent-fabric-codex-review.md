---
"forgeos": patch
---

Add a local Agent Fabric change-review flow for Codex App authored diffs. It
captures an exact staged, unstaged, and new-file snapshot, runs a bounded
read-only Codex CLI reviewer on an isolated checkout, and keeps digest-bound
review rounds and findings. CLI and MCP expose proposal and evidence while
reviewer dispatch remains an explicit CLI action.
