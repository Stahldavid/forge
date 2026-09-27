---
"forgeos": patch
---

Add a single local Agent Fabric owner process so CLI and MCP clients share the
same PGlite-backed task service. MCP can submit untrusted proposals and read
status while owner approval, execution, and diff acceptance remain outside MCP.
