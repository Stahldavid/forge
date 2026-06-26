import { spawnSync } from "node:child_process";
import { createWorkspaceBaseline, readWorkspaceBaseline, writeWorkspaceBaseline, WORKSPACE_BASELINE_PATH } from "../workspace/baseline.ts";
import { listWorkspaceFiles } from "../workspace/git-summary.ts";

export type BaselineSubcommand = "create" | "status";

export interface BaselineCommandOptions {
  subcommand: BaselineSubcommand;
  workspaceRoot: string;
  json: boolean;
  reason?: string;
}

export interface BaselineCommandResult {
  ok: boolean;
  path: string;
  required: boolean;
  created?: boolean;
  baseline?: ReturnType<typeof readWorkspaceBaseline>;
  summary: {
    files: number;
    reason?: string;
    tracking: "git" | "forge-baseline" | "missing";
  };
  nextActions: string[];
  exitCode: 0 | 1;
}

function gitAvailable(workspaceRoot: string): boolean {
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: workspaceRoot,
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0;
}

export function runBaselineCommand(options: BaselineCommandOptions): BaselineCommandResult {
  if (options.subcommand === "create") {
    const files = listWorkspaceFiles(options.workspaceRoot);
    const baseline = createWorkspaceBaseline({
      workspaceRoot: options.workspaceRoot,
      files,
      reason: options.reason,
    });
    writeWorkspaceBaseline(options.workspaceRoot, baseline);
    return {
      ok: true,
      path: WORKSPACE_BASELINE_PATH,
      required: false,
      created: true,
      baseline,
      summary: {
        files: Object.keys(baseline.files).length,
        tracking: "forge-baseline",
        ...(baseline.reason ? { reason: baseline.reason } : {}),
      },
      nextActions: ["forge changed --json", "forge handoff --json"],
      exitCode: 0,
    };
  }

  const baseline = readWorkspaceBaseline(options.workspaceRoot);
  if (!baseline && gitAvailable(options.workspaceRoot)) {
    return {
      ok: true,
      path: WORKSPACE_BASELINE_PATH,
      required: false,
      baseline: null,
      summary: {
        files: 0,
        tracking: "git",
      },
      nextActions: ["forge changed --json", "git status --short"],
      exitCode: 0,
    };
  }
  return {
    ok: baseline !== null,
    path: WORKSPACE_BASELINE_PATH,
    required: baseline === null,
    baseline,
    summary: {
      files: baseline ? Object.keys(baseline.files).length : 0,
      tracking: baseline ? "forge-baseline" : "missing",
      ...(baseline?.reason ? { reason: baseline.reason } : {}),
    },
    nextActions: baseline
      ? ["forge changed --json", "forge baseline create --reason refresh --json"]
      : ["forge baseline create --reason initial-scaffold --json", "git init"],
    exitCode: baseline ? 0 : 1,
  };
}

export function formatBaselineJson(result: BaselineCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatBaselineHuman(result: BaselineCommandResult): string {
  const label = result.required ? "missing" : result.summary.tracking === "git" ? "not required (git workspace)" : "ready";
  const lines = [
    `Forge baseline: ${label}`,
    `Path: ${result.path}`,
    `Tracking: ${result.summary.tracking}`,
    `Files: ${result.summary.files}`,
  ];
  if (result.summary.reason) {
    lines.push(`Reason: ${result.summary.reason}`);
  }
  lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  return `${lines.join("\n")}\n`;
}
