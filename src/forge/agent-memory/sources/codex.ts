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
