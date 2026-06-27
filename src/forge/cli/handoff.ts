import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { runDevConsoleCycle } from "../dev-console/cycle.ts";
import type { DevConsoleCycle, DevConsolePhase } from "../dev-console/types.ts";
import type { TestRunRecord } from "../impact/types.ts";
import type { UiRunReport } from "../ui/types.ts";
import { summarizeChangeTypes, type CategorizedFileSummary } from "../workspace/change-summary.ts";
import { forgeCliCommandsForWorkspace } from "../workspace/forge-cli.ts";
import { buildWorkspaceGitSummary } from "../workspace/git-summary.ts";
import { runChangedCommand } from "./changed.ts";

export interface HandoffCommandOptions {
  workspaceRoot: string;
  json: boolean;
  commitReady?: boolean;
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
  commitReady?: {
    count: number;
    files: string[];
  };
  diagnosticSummary: {
    total: number;
    sample: Diagnostic[];
    hidden: number;
    bySeverity: Record<string, number>;
    byCode: Record<string, number>;
    fullDiagnosticsCommands: string[];
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

function compactDiagnostics(
  workspaceRoot: string,
  diagnostics: Diagnostic[],
  sampleSize = 8,
): HandoffCommandResult["diagnosticSummary"] {
  const bySeverity: Record<string, number> = {};
  const byCode: Record<string, number> = {};
  for (const diagnostic of diagnostics) {
    bySeverity[diagnostic.severity] = (bySeverity[diagnostic.severity] ?? 0) + 1;
    byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
  }
  return {
    total: diagnostics.length,
    sample: diagnostics.slice(0, sampleSize),
    hidden: Math.max(0, diagnostics.length - sampleSize),
    bySeverity,
    byCode,
    fullDiagnosticsCommands: forgeCliCommandsForWorkspace(workspaceRoot, [
      "forge dev --once --json",
      "forge inspect all --full --json",
      "forge generate --check --json",
    ]),
  };
}

export async function runHandoffCommand(options: HandoffCommandOptions): Promise<HandoffCommandResult> {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const dev = await runDevConsoleCycle({
    workspaceRoot,
    mode: "once",
    generatedMode: "check",
    includeImpact: true,
  });
  const git = buildWorkspaceGitSummary(workspaceRoot);
  const commitReady = options.commitReady
    ? runChangedCommand(workspaceRoot, { commitReady: true }).data.commitReady as { count: number; files: string[] } | undefined
    : undefined;
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
    ...forgeCliCommandsForWorkspace(workspaceRoot, [
      ...(git.changed.count > 0 ? ["forge review run --changed --json"] : []),
      "forge handoff --json",
    ]),
  ];
  const ok = dev.ok &&
    agent.blockingIssues.length === 0 &&
    (!recentRuns.test || recentRuns.test.ok) &&
    (!recentRuns.ui || recentRuns.ui.ok);
  const changedFiles = Math.max(agent.changedFiles, git.changed.count);
  const diagnosticSummary = compactDiagnostics(workspaceRoot, dev.diagnostics);

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
    ...(commitReady ? { commitReady } : {}),
    diagnosticSummary,
    diagnostics: diagnosticSummary.sample,
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
  if (result.diagnosticSummary.total > 0) {
    lines.push(
      "",
      "Diagnostics:",
      `  ${result.diagnosticSummary.total} total` +
        (result.diagnosticSummary.hidden > 0 ? ` (${result.diagnosticSummary.hidden} hidden in compact handoff)` : ""),
    );
  }
  if (result.commitReady) {
    lines.push("", "Commit-ready files:", `  ${result.commitReady.count}`);
    lines.push(...result.commitReady.files.slice(0, 8).map((file) => `  ${file}`));
    if (result.commitReady.files.length > 8) {
      lines.push(`  ... ${result.commitReady.files.length - 8} more`);
    }
  }
  const changedTypes = summarizeChangeTypes(result.git.changeSummary.changed);
  if (changedTypes) {
    lines.push("", "Change types:", `  ${changedTypes}`);
  }
  return `${lines.join("\n")}\n`;
}
