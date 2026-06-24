import type { CategorizedFileSummary, DiffPlan } from "../workspace/change-summary.ts";
import { buildDiffPlanFromChangeSummary, summarizeChangeTypes } from "../workspace/change-summary.ts";
import { buildWorkspaceGitSummary, type WorkspaceGitSummary } from "../workspace/git-summary.ts";

export interface ChangedCommandResult {
  ok: boolean;
  data: Record<string, unknown>;
  exitCode: 0 | 1;
}

interface HumanChangeSummary {
  total: number;
  source: CategorizedFileSummary["byType"]["source"];
  tests: CategorizedFileSummary["byType"]["tests"];
  docs: CategorizedFileSummary["byType"]["docs"];
  config: CategorizedFileSummary["byType"]["config"];
  operational: CategorizedFileSummary["byType"]["operational"];
  assets: CategorizedFileSummary["byType"]["assets"];
  other: CategorizedFileSummary["byType"]["other"];
}

interface DerivedChangeSummary {
  total: number;
  generated: CategorizedFileSummary["byType"]["generated"];
}

interface ReviewFocus {
  first: "humanChanges";
  then: "derivedChanges";
  generatedIsDerived: boolean;
  suggestedOrder: Array<keyof HumanChangeSummary | "generated">;
  summary: string;
}

interface GeneratedChangeExplanation {
  kind: "none" | "mixed-with-authored" | "versioned-generated-only";
  generatorCheckMeaning: string;
  gitMeaning: string;
  summary: string;
}

function emptyCategory(summary: CategorizedFileSummary, category: keyof CategorizedFileSummary["byType"]): boolean {
  return summary.byType[category].count === 0;
}

function selectHumanChangeSummary(summary: CategorizedFileSummary): HumanChangeSummary {
  const source = summary.byType.source;
  const tests = summary.byType.tests;
  const docs = summary.byType.docs;
  const config = summary.byType.config;
  const operational = summary.byType.operational;
  const assets = summary.byType.assets;
  const other = summary.byType.other;
  const total =
    source.count +
    tests.count +
    docs.count +
    config.count +
    operational.count +
    assets.count +
    other.count;
  return {
    total,
    source,
    tests,
    docs,
    config,
    operational,
    assets,
    other,
  };
}

function selectDerivedChangeSummary(summary: CategorizedFileSummary): DerivedChangeSummary {
  return {
    total: summary.byType.generated.count,
    generated: summary.byType.generated,
  };
}

function buildRisks(git: WorkspaceGitSummary): string[] {
  const risks: string[] = [];
  const changed = git.changeSummary.changed;
  if (!git.available) {
    risks.push("git status is unavailable; changed-file analysis may be incomplete");
    return risks;
  }
  if (git.untracked.count > 0) {
    risks.push(`${git.untracked.count} untracked file(s) are not in git history`);
  }
  if (changed.byType.other.count > 0) {
    risks.push(`${changed.byType.other.count} changed file(s) were not recognized by ForgeOS categories`);
  }
  const humanChanges = selectHumanChangeSummary(changed);
  if (!emptyCategory(changed, "generated") && humanChanges.total === 0) {
    risks.push("only generated artifacts changed; verify the source edit, generator input, or intentional regeneration that produced them");
  }
  if (changed.total.count > 50) {
    risks.push(`${changed.total.count} changed file(s) detected; use the grouped summaries before reviewing raw diffs`);
  }
  return risks;
}

function buildRecommendedCommands(git: WorkspaceGitSummary): string[] {
  if (!git.available) {
    return ["git status --short", "forge status --json"];
  }
  if (git.changeSummary.changed.total.count === 0) {
    return ["forge status --json", "forge dev --once --json"];
  }
  const changed = git.changeSummary.changed;
  const humanFiles = changed.total.count - changed.byType.generated.count;
  if (humanFiles === 0 && changed.byType.generated.count > 0) {
    return [
      "forge changed --authored --json",
      "forge status --json",
      "forge generate --check --json",
    ];
  }
  return [
    "forge handoff --json",
    "forge test plan --changed --json",
    "forge verify --changed",
    "forge review run --changed --json",
  ];
}

function buildReviewFocus(humanChanges: HumanChangeSummary, derivedChanges: DerivedChangeSummary): ReviewFocus {
  const authoredOrder = ([
    "source",
    "tests",
    "docs",
    "config",
    "operational",
    "assets",
    "other",
  ] as Array<keyof HumanChangeSummary>)
    .filter((category) => category !== "total" && humanChanges[category].count > 0);
  const suggestedOrder: ReviewFocus["suggestedOrder"] = [...authoredOrder];
  if (derivedChanges.total > 0) {
    suggestedOrder.push("generated");
  }
  return {
    first: "humanChanges",
    then: "derivedChanges",
    generatedIsDerived: true,
    suggestedOrder,
    summary: derivedChanges.total > 0
      ? "Review authored source/tests/docs first; inspect generated artifacts after the source cause is understood."
      : "Review authored changes directly; no generated artifacts changed.",
  };
}

function buildGeneratedChangeExplanation(
  humanChanges: HumanChangeSummary,
  derivedChanges: DerivedChangeSummary,
): GeneratedChangeExplanation {
  if (derivedChanges.total === 0) {
    return {
      kind: "none",
      generatorCheckMeaning: "forge generate --check verifies generated files match current workspace inputs.",
      gitMeaning: "git status has no generated artifact changes.",
      summary: "No generated artifacts changed.",
    };
  }
  if (humanChanges.total === 0) {
    return {
      kind: "versioned-generated-only",
      generatorCheckMeaning: "forge generate --check verifies generated files match current workspace inputs; it does not mean generated artifacts match HEAD.",
      gitMeaning: "git status is showing versioned generated artifacts that differ from HEAD.",
      summary: "Generated artifacts are consistent with current inputs but differ from git HEAD; review or discard them intentionally.",
    };
  }
  return {
    kind: "mixed-with-authored",
    generatorCheckMeaning: "forge generate --check verifies generated files match current workspace inputs.",
    gitMeaning: "git status includes generated artifacts alongside authored changes.",
    summary: "Review authored changes first; generated artifacts should be explained by those source inputs.",
  };
}

export function runChangedCommand(workspaceRoot: string, options: { authoredOnly?: boolean } = {}): ChangedCommandResult {
  const git = buildWorkspaceGitSummary(workspaceRoot);
  const changed = git.changeSummary.changed;
  const humanChanges = selectHumanChangeSummary(changed);
  const derivedChanges = selectDerivedChangeSummary(changed);
  const authoredChanged: CategorizedFileSummary = {
    ...changed,
    total: { ...changed.total, count: humanChanges.total },
    byType: {
      ...changed.byType,
      generated: { count: 0, sample: [], hidden: 0 },
    },
    primaryTypes: changed.primaryTypes.filter((type) => type !== "generated"),
  };
  const viewChanged = options.authoredOnly ? authoredChanged : changed;
  const viewDerivedChanges: DerivedChangeSummary = options.authoredOnly
    ? { total: 0, generated: { count: 0, sample: [], hidden: 0 } }
    : derivedChanges;
  const risks = buildRisks(git);
  const recommendedCommands = buildRecommendedCommands(git);
  const reviewFocus = buildReviewFocus(humanChanges, viewDerivedChanges);
  const generatedExplanation = buildGeneratedChangeExplanation(humanChanges, viewDerivedChanges);
  const diffPlan: DiffPlan = buildDiffPlanFromChangeSummary(viewChanged);

  return {
    ok: git.available,
    data: {
      schemaVersion: "0.1.0",
      ok: git.available,
      summary: {
        branch: git.branch,
        commit: git.commit,
        view: options.authoredOnly ? "authored" : "all",
        changedFiles: viewChanged.total.count,
        humanFiles: humanChanges.total,
        generatedFiles: viewDerivedChanges.total,
        stagedFiles: git.staged.count,
        unstagedFiles: git.unstaged.count,
        untrackedFiles: git.untracked.count,
        primaryTypes: viewChanged.primaryTypes,
        changeTypes: summarizeChangeTypes(viewChanged),
      },
      git: {
        available: git.available,
        ...(git.error ? { error: git.error } : {}),
        branch: git.branch,
        commit: git.commit,
        changed: viewChanged,
        staged: git.changeSummary.staged,
        unstaged: git.changeSummary.unstaged,
        untracked: git.changeSummary.untracked,
      },
      humanChanges,
      derivedChanges: viewDerivedChanges,
      reviewFocus,
      generatedExplanation,
      diffPlan,
      risks,
      recommendedCommands,
      nextActions: recommendedCommands,
    },
    exitCode: git.available ? 0 : 1,
  };
}

export function formatChangedHuman(result: ChangedCommandResult): string {
  const summary = result.data.summary as Record<string, unknown>;
  const human = result.data.humanChanges as Record<string, { count: number; sample: string[]; hidden: number } | number>;
  const derived = result.data.derivedChanges as Record<string, { count: number; sample: string[]; hidden: number } | number>;
  const reviewFocus = result.data.reviewFocus as { summary?: string; suggestedOrder?: string[] } | undefined;
  const generatedExplanation = result.data.generatedExplanation as { summary?: string } | undefined;
  const diffPlan = result.data.diffPlan as { summary?: string; authoredDiffCommand?: string; generatedDiffCommand?: string; generatedCollapsedByDefault?: boolean } | undefined;
  const risks = (result.data.risks as string[] | undefined) ?? [];
  const nextActions = (result.data.nextActions as string[] | undefined) ?? [];
  const lines = [
    `Forge changed: ${result.ok ? "ready" : "git unavailable"}`,
    `Branch: ${summary.branch ?? "unknown"} @ ${summary.commit ?? "unknown"}`,
    `Changed: ${summary.changedFiles ?? 0} (${summary.changeTypes || "none"})`,
    `Human files: ${summary.humanFiles ?? 0}`,
    `Generated files: ${summary.generatedFiles ?? 0}`,
  ];

  if (reviewFocus?.summary) {
    lines.push(`Review focus: ${reviewFocus.summary}`);
    if (reviewFocus.suggestedOrder && reviewFocus.suggestedOrder.length > 0) {
      lines.push(`Review order: ${reviewFocus.suggestedOrder.join(" -> ")}`);
    }
  }
  if (generatedExplanation?.summary) {
    lines.push(`Generated explanation: ${generatedExplanation.summary}`);
  }

  if (diffPlan?.summary) {
    lines.push(`Diff plan: ${diffPlan.summary}`);
    lines.push(`  authored: ${diffPlan.authoredDiffCommand ?? "git diff"}`);
    if (diffPlan.generatedCollapsedByDefault) {
      lines.push(`  generated: ${diffPlan.generatedDiffCommand ?? "git diff -- src/forge/_generated forge.lock"}`);
    }
  }

  for (const category of ["source", "tests", "docs", "config", "operational", "assets", "other"] as const) {
    const value = human[category];
    if (typeof value === "object" && value.count > 0) {
      lines.push(`  ${category}: ${value.count} ${value.sample.join(", ")}${value.hidden > 0 ? ` (+${value.hidden})` : ""}`);
    }
  }

  const generated = derived.generated;
  if (typeof generated === "object" && generated.count > 0) {
    lines.push(`  generated: ${generated.count} ${generated.sample.join(", ")}${generated.hidden > 0 ? ` (+${generated.hidden})` : ""}`);
  }

  if (risks.length > 0) {
    lines.push("", "Risks:", ...risks.map((risk) => `  ${risk}`));
  }

  lines.push("", "Next:", ...nextActions.map((command) => `  ${command}`));
  return `${lines.join("\n")}\n`;
}
