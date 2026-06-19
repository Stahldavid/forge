import type { AgentInstallResult } from "../types.ts";

const CODEX_EVENTS = [
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

export function codexInstallFiles(): Array<{ path: string; content: string }> {
  const hook = {
    hooks: Object.fromEntries(CODEX_EVENTS.map((event) => [
      event,
      [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `forge agent ingest codex --event ${event}`,
              timeout: 30,
              statusMessage: CODEX_EVENT_STATUS[event] ?? "Recording Codex event",
            },
          ],
        },
      ],
    ])),
  };
  return [
    { path: ".codex/hooks.json", content: `${JSON.stringify(hook, null, 2)}\n` },
  ];
}

export function codexInstallResult(filesWritten: string[], filesPlanned: string[]): AgentInstallResult {
  return {
    ok: true,
    target: "codex",
    filesWritten,
    filesPlanned,
    privacy: privacyDefaults(),
    warnings: ["Codex memories and transcripts are not imported automatically."],
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
