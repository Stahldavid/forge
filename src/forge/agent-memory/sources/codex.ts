import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseManifest } from "../../_generated/releaseManifest.ts";
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

export const CODEX_HOOK_RUNNER_RELATIVE = ".forge/agent/codex-hook.mjs";
export const CODEX_HOOK_META_RELATIVE = ".forge/agent/codex-hook.meta.json";
export const CODEX_HOOK_QUEUE_RELATIVE = ".forge/agent/events.ndjson";

const FAST_HOOK_EVENTS = new Set(["PreToolUse", "PostToolUse"]);

function codexHookTimeout(event: string): number {
  return FAST_HOOK_EVENTS.has(event) ? 2 : 3;
}

function codexHookCommand(event: string): string {
  return `node ${CODEX_HOOK_RUNNER_RELATIVE} ${event}`;
}

function readCodexHookRunnerSource(): string {
  const path = join(dirname(fileURLToPath(import.meta.url)), "codex-hook-runner.mjs");
  return readFileSync(path, "utf8");
}

export function codexHookMetaContent(workspaceRoot: string): string {
  const meta = {
    schema: "forge.codex-hook.meta.v1",
    forgeVersion: releaseManifest.packageVersion,
    installedAt: new Date().toISOString(),
    commandResolvedFrom: "workspace",
    workspaceRoot,
    runner: CODEX_HOOK_RUNNER_RELATIVE,
    queueFile: CODEX_HOOK_QUEUE_RELATIVE,
    stdinTimeoutMs: 750,
    hookTimeouts: Object.fromEntries(CODEX_EVENTS.map((event) => [event, codexHookTimeout(event)])),
  };
  return `${JSON.stringify(meta, null, 2)}\n`;
}

export function codexInstallFiles(workspaceRoot?: string): Array<{ path: string; content: string }> {
  const hook = {
    hooks: Object.fromEntries(CODEX_EVENTS.map((event) => [
      event,
      [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: codexHookCommand(event),
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
    files.push({ path: CODEX_HOOK_META_RELATIVE, content: codexHookMetaContent(workspaceRoot) });
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
      "Hooks enqueue to .forge/agent/events.ndjson; run forge agent ingest codex --watch to drain into Agent Memory.",
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
