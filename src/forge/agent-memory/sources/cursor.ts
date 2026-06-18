import type { AgentInstallResult } from "../types.ts";
import { privacyDefaults } from "./codex.ts";

export function cursorInstallFiles(): Array<{ path: string; content: string }> {
  return [
    {
      path: ".cursor/mcp.json",
      content: `${JSON.stringify({
        mcpServers: {
          forgeos: {
            type: "stdio",
            command: "forge",
            args: ["mcp", "serve"],
          },
        },
      }, null, 2)}\n`,
    },
    {
      path: ".cursor/rules/forgeos-agent-memory.mdc",
      content: `---\ndescription: ForgeOS Agent Memory Bridge context and MCP workflow.\nalwaysApply: true\n---\n\n# ForgeOS Agent Memory\n\n- Before modifying runtime entries, call the ForgeOS MCP tool \`agent_context\` or run \`forge agent context --current --json\`.\n- Prefer ForgeOS MCP tools for inspect, timeline, check, verify, and agent context.\n- Do not edit \`src/forge/_generated/**\` directly.\n- Do not expose destructive or write tools without approval metadata.\n- After changes, run \`forge check --json\`; use \`forge verify --strict\` before handoff.\n- Do not ask ForgeOS to read Cursor internal chats, checkpoints, or editor databases.\n`,
    },
  ];
}

export function cursorInstallResult(filesWritten: string[], filesPlanned: string[]): AgentInstallResult {
  return {
    ok: true,
    target: "cursor",
    filesWritten,
    filesPlanned,
    privacy: privacyDefaults(),
    warnings: ["Cursor internal chats, checkpoints, and databases are not read by ForgeOS."],
    exitCode: 0,
  };
}
