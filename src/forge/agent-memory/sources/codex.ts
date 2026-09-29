import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseManifest } from "../../_generated/releaseManifest.ts";
import type { AgentInstallResult } from "../types.ts";

export const CODEX_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
  "Stop",
];

const CODEX_EVENT_STATUS: Record<string, string> = {
  SessionStart: "Recording Codex session start",
  UserPromptSubmit: "Recording Codex prompt metadata",
  PreToolUse: "Recording Codex tool request",
  PermissionRequest: "Recording Codex approval request",
  PostToolUse: "Recording Codex tool result",
  SubagentStart: "Recording Codex subagent start",
  SubagentStop: "Recording Codex subagent stop",
  PreCompact: "Recording Codex compaction start",
  PostCompact: "Recording Codex compaction result",
  Stop: "Recording Codex turn stop",
};

export const CODEX_HOOK_RUNNER_RELATIVE = ".forge/agent/codex-hook.mjs";
export const CODEX_HOOK_META_RELATIVE = ".forge/agent/codex-hook.meta.json";
export const CODEX_HOOK_QUEUE_RELATIVE = ".forge/agent/events.ndjson";
export const CODEX_MCP_HOOK_TOOL = "agent_hook_ingest";

const FAST_HOOK_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

function codexHookTimeout(event: string): number {
  return FAST_HOOK_EVENTS.has(event) ? 2 : 3;
}

function codexHookCommand(event: string): string {
  return `node ${CODEX_HOOK_RUNNER_RELATIVE} ${event}`;
}

function codexMcpHookPayload(event: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    hook_event_name: "${hook_event_name}",
    session_id: "${session_id}",
    cwd: "${cwd}",
    model: "${model}",
  };
  if (["PreToolUse", "PostToolUse", "PermissionRequest"].includes(event)) {
    payload.turn_id = "${turn_id}";
    payload.tool_name = "${tool_name}";
    payload.tool_input = "${tool_input}";
  }
  if (["PreToolUse", "PostToolUse"].includes(event)) payload.tool_use_id = "${tool_use_id}";
  if (event === "PostToolUse") {
    // Large tool output must not fill the synchronous MCP hook request.
    payload.tool_response = {
      exitCode: "${tool_response.exitCode}",
      exit_code: "${tool_response.exit_code}",
      status: "${tool_response.status}",
    };
  }
  if (["PreCompact", "PostCompact"].includes(event)) {
    payload.turn_id = "${turn_id}";
    payload.trigger = "${trigger}";
  }
  return payload;
}

function readCodexHookRunnerSource(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), "codex-hook-runner.mjs");
  return readFileSync(path, "utf8");
}

export function codexHookMetaContent(workspaceRoot: string, mcpServer?: string): string {
  const meta = {
    schema: "forge.codex-hook.meta.v1",
    forgeVersion: releaseManifest.packageVersion,
    installedAt: new Date().toISOString(),
    commandResolvedFrom: "workspace",
    workspaceRoot,
    runner: CODEX_HOOK_RUNNER_RELATIVE,
    queueFile: CODEX_HOOK_QUEUE_RELATIVE,
    transport: mcpServer ? "mcp_tool" : "command",
    ...(mcpServer ? { mcpServer } : {}),
    brokerRunnerPath: fileURLToPath(new URL("../../delta/broker-runner.mjs", import.meta.url)),
    stdinTimeoutMs: 750,
    hookTimeouts: Object.fromEntries(CODEX_EVENTS.map((event) => [event, codexHookTimeout(event)])),
  };
  return `${JSON.stringify(meta, null, 2)}\n`;
}

export function codexInstallFiles(workspaceRoot?: string, mcpServer?: string): Array<{ path: string; content: string }> {
  if (mcpServer && !/^[A-Za-z0-9_-]{1,64}$/u.test(mcpServer)) {
    throw new Error("Codex MCP server name must be 1-64 letters, digits, underscores, or hyphens");
  }
  const hook = {
    hooks: Object.fromEntries(CODEX_EVENTS.map((event) => [
      event,
      [
        {
          matcher: "*",
          hooks: [
            {
              ...(mcpServer ? {
                type: "mcp_tool",
                server: mcpServer,
                tool: CODEX_MCP_HOOK_TOOL,
                input: {
                  eventName: event,
                  payload: codexMcpHookPayload(event),
                },
              } : { type: "command", command: codexHookCommand(event) }),
              timeout: codexHookTimeout(event),
              statusMessage: CODEX_EVENT_STATUS[event] ?? "Recording Codex event",
            },
          ],
        },
      ],
    ])),
  };
  const files: Array<{ path: string; content: string }> = [
    { path: ".codex/hooks.json", content: `${JSON.stringify(hook, null, 2)}\n` },
    { path: CODEX_HOOK_RUNNER_RELATIVE, content: readCodexHookRunnerSource() },
  ];
  if (workspaceRoot) {
    files.push({ path: CODEX_HOOK_META_RELATIVE, content: codexHookMetaContent(workspaceRoot, mcpServer) });
  }
  return files;
}

export function codexInstallResult(filesWritten: string[], filesPlanned: string[]): AgentInstallResult {
  return {
    ok: true,
    target: "codex",
    filesWritten,
    filesPlanned,
    privacy: privacyDefaults(),
    warnings: [
      "Codex memories and transcripts are not imported automatically.",
      "Hooks enqueue to .forge/agent/events.ndjson; Agent Memory drains the queue automatically when read.",
    ],
    exitCode: 0,
  };
}

export function privacyDefaults(): AgentInstallResult["privacy"] {
  return {
    rawPrompts: "off",
    rawCompletions: "off",
    rawToolArgs: "off",
    transcriptImport: "off",
    cloudSync: "off",
  };
}
