import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { runDevConsoleCycle } from "../dev-console/cycle.ts";
import type { DevConsoleCycle, DevConsolePhase } from "../dev-console/types.ts";
import type { TestRunRecord } from "../impact/types.ts";
import type { UiRunReport } from "../ui/types.ts";
import { summarizeChangeTypes, type CategorizedFileSummary } from "../workspace/change-summary.ts";
import { buildWorkspaceGitSummary } from "../workspace/git-summary.ts";

export interface HandoffCommandOptions {
  workspaceRoot: string;
  json: boolean;
}

export interface HandoffCommandResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  summary: {
    projectRoot: string;
    safeToEdit: boolean;
    generatedFresh: boolean;
    generatedChanged: boolean;
    generatedChangedFiles: number;
    frontendReady: boolean;
    changedFiles: number;
    stagedFiles: number;
    unstagedFiles: number;
    untrackedFiles: number;
    lastTestRun: "passed" | "failed" | "missing";
    lastUiRun: "passed" | "failed" | "missing";
    workspaceMode: "git" | "nonGit";
    tracking: string;
  };
  dev: {
    ok: boolean;
    primaryAction?: DevConsoleCycle["summary"]["primaryAction"];
    agentContext: DevConsoleCycle["summary"]["agentContext"];
    phases: Array<Pick<DevConsolePhase, "name" | "status" | "message">>;
  };
  git: {
    available: boolean;
    branch?: string;
    commit?: string;
    changed: {
      count: number;
      sample: string[];
      hidden: number;
    };
    staged: {
      count: number;
      sample: string[];
      hidden: number;
    };
    unstaged: {
      count: number;
      sample: string[];
      hidden: number;
    };
    untracked: {
      count: number;
      sample: string[];
      hidden: number;
    };
    changeSummary: {
      changed: CategorizedFileSummary;
      staged: CategorizedFileSummary;
      unstaged: CategorizedFileSummary;
      untracked: CategorizedFileSummary;
    };
    workspaceMode?: string;
    tracking?: string;
    baseline?: unknown;
    error?: string;
  };
  recentRuns: {
    test?: {
      id?: string;
      ok: boolean;
      failed: string[];
      durationMs?: number;
    };
    ui?: {
      id?: string;
      ok: boolean;
      failedScenarios: string[];
    };
  };
  nextAgent: {
    openingBrief: string;
    recommendedReadFiles: string[];
    recommendedCommands: string[];
    risks: string[];
  };
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

function readJson<T>(workspaceRoot: string, relativePath: string): T | null {
  const absolute = join(workspaceRoot, relativePath);
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(absolute) ?? "null") as T;
  } catch {
    return null;
  }
}

function summarizeRecentRuns(workspaceRoot: string): HandoffCommandResult["recentRuns"] {
  const test = readJson<TestRunRecord>(workspaceRoot, ".forge/test-runs/last.json");
  const ui = readJson<UiRunReport>(workspaceRoot, ".forge/ui-runs/last.json");
  const failedScenarios = (ui?.scenarios ?? [])
    .filter((scenario) => !scenario.ok)
    .map((scenario) => scenario.name);
  return {
    ...(test
      ? {
          test: {
            id: test.id,
            ok: test.failed.length === 0,
            failed: test.failed,
            durationMs: test.durationMs,
          },
        }
      : {}),
    ...(ui
      ? {
          ui: {
            id: ui.id,
            ok: failedScenarios.length === 0 && ui.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
            failedScenarios,
          },
        }
      : {}),
  };
}

function buildOpeningBrief(input: {
  dev: DevConsoleCycle;
  git: HandoffCommandResult["git"];
  recentRuns: HandoffCommandResult["recentRuns"];
}): string {
  const agent = input.dev.summary.agentContext;
  const changedByType = summarizeChangeTypes(input.git.changeSummary.changed);
  const changedFiles = Math.max(agent.changedFiles, input.git.changed.count);
  const tests = input.recentRuns.test
    ? input.recentRuns.test.ok
      ? "last test run passed"
      : "last test run failed"
    : "no last test run";
  const blockers = agent.blockingIssues.length > 0
    ? `${agent.blockingIssues.length} blocking issue(s)`
    : "no blocking issues";
  return [
    `ForgeOS handoff: ${input.dev.ok ? "dev diagnostics are clean" : "dev diagnostics need attention"}.`,
    `${changedFiles} changed file(s)${changedByType ? `: ${changedByType}` : ""}; ${input.git.staged.count} staged, ${input.git.untracked.count} untracked.`,
    `${tests}; ${blockers}.`,
    `Next command: ${input.dev.summary.primaryAction?.command ?? input.dev.nextActions[0]?.command ?? "forge dev"}.`,
  ].join(" ");
}

export async function runHandoffCommand(options: HandoffCommandOptions): Promise<HandoffCommandResult> {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const dev = await runDevConsoleCycle({
    workspaceRoot,
    mode: "once",
    includeImpact: true,
  });
  const git = buildWorkspaceGitSummary(workspaceRoot);
  const recentRuns = summarizeRecentRuns(workspaceRoot);
  const agent = dev.summary.agentContext;
  const risks = [
    ...agent.blockingIssues,
    ...(!git.available && git.source === "forge-baseline"
      ? ["git status is unavailable; using Forge workspace baseline for non-git change tracking"]
      : !git.available
        ? ["git status is unavailable; using filesystem inventory as untracked-file analysis"]
        : []),
    ...(git.untracked.count > 0 && git.source !== "forge-baseline" ? [`${git.untracked.count} untracked file(s) are not in git history`] : []),
    ...(recentRuns.test && !recentRuns.test.ok ? ["last test run failed"] : []),
    ...(recentRuns.ui && !recentRuns.ui.ok ? ["last UI run failed"] : []),
  ];
  const nextActions = [
    ...agent.recommendedCommands,
    ...(git.changed.count > 0 ? ["forge review run --changed --json"] : []),
    "forge handoff --json",
  ];
  const ok = dev.ok &&
    agent.blockingIssues.length === 0 &&
    (!recentRuns.test || recentRuns.test.ok) &&
    (!recentRuns.ui || recentRuns.ui.ok);
  const changedFiles = Math.max(agent.changedFiles, git.changed.count);

  return {
    schemaVersion: "0.1.0",
    ok,
    summary: {
      projectRoot: workspaceRoot,
      safeToEdit: agent.safeToEdit,
      generatedFresh: agent.generatedFresh,
      generatedChanged: agent.generatedChanged,
      generatedChangedFiles: agent.generatedChangedFiles,
      frontendReady: agent.frontendReady,
      changedFiles,
      stagedFiles: git.staged.count,
      unstagedFiles: git.unstaged.count,
      untrackedFiles: git.untracked.count,
      lastTestRun: recentRuns.test ? (recentRuns.test.ok ? "passed" : "failed") : "missing",
      lastUiRun: recentRuns.ui ? (recentRuns.ui.ok ? "passed" : "failed") : "missing",
      workspaceMode: git.workspaceMode ?? (git.available ? "git" : "nonGit"),
      tracking: git.tracking ?? git.source ?? "git",
    },
    dev: {
      ok: dev.ok,
      ...(dev.summary.primaryAction ? { primaryAction: dev.summary.primaryAction } : {}),
      agentContext: agent,
      phases: dev.phases.map((phase) => ({
        name: phase.name,
        status: phase.status,
        ...(phase.message ? { message: phase.message } : {}),
      })),
    },
    git,
    recentRuns,
    nextAgent: {
      openingBrief: buildOpeningBrief({ dev, git, recentRuns }),
      recommendedReadFiles: agent.recommendedReadFiles,
      recommendedCommands: [...new Set(nextActions)].slice(0, 10),
      risks,
    },
    diagnostics: dev.diagnostics,
    nextActions: [...new Set(nextActions)].slice(0, 10),
    exitCode: ok ? 0 : 1,
  };
}

export function formatHandoffJson(result: HandoffCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatHandoffHuman(result: HandoffCommandResult): string {
  const lines = [
    `Forge handoff: ${result.ok ? "ready" : "needs attention"}`,
    result.nextAgent.openingBrief,
    "",
    "Read first:",
    ...result.nextAgent.recommendedReadFiles.slice(0, 6).map((file) => `  ${file}`),
    "",
    "Next commands:",
    ...result.nextActions.slice(0, 6).map((command) => `  ${command}`),
  ];
  if (result.nextAgent.risks.length > 0) {
    lines.push("", "Risks:");
    lines.push(...result.nextAgent.risks.slice(0, 6).map((risk) => `  ${risk}`));
  }
  const changedTypes = summarizeChangeTypes(result.git.changeSummary.changed);
  if (changedTypes) {
    lines.push("", "Change types:", `  ${changedTypes}`);
  }
  return `${lines.join("\n")}\n`;
}
