import type { AgentInstallResult } from "../types.ts";
import { privacyDefaults } from "./codex.ts";

const CLAUDE_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionDenied",
  "FileChanged",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
];

export function claudeCodeInstallFiles(): Array<{ path: string; content: string }> {
  const settings = {
    hooks: Object.fromEntries(CLAUDE_EVENTS.map((event) => [
      event,
      [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `forge agent ingest claude-code --event ${event}`,
            },
          ],
        },
      ],
    ])),
  };
  return [
    { path: ".claude/settings.json", content: `${JSON.stringify(settings, null, 2)}\n` },
  ];
}

export function claudeCodeInstallResult(filesWritten: string[], filesPlanned: string[]): AgentInstallResult {
  return {
    ok: true,
    target: "claude-code",
    filesWritten,
    filesPlanned,
    privacy: privacyDefaults(),
    warnings: ["Claude transcript imports are opt-in only; hooks store redacted project memory."],
    exitCode: 0,
  };
}
