export type ChangeType =
  | "source"
  | "tests"
  | "docs"
  | "generated"
  | "operational"
  | "assets"
  | "config"
  | "other";

export type FileListSummary = {
  count: number;
  sample: string[];
  hidden: number;
};

export type CategorizedFileSummary = {
  total: FileListSummary;
  byType: Record<ChangeType, FileListSummary>;
  primaryTypes: ChangeType[];
};

export type DiffPlan = {
  first: "authored";
  then: "generated";
  generatedCollapsedByDefault: boolean;
  generatedFiles: number;
  authoredFiles: number;
  authoredDiffCommand: string;
  generatedDiffCommand: string;
  fullDiffCommand: string;
  summary: string;
};

export type ChangeClassifier = (file: string) => ChangeType;

export const CHANGE_TYPES: ChangeType[] = [
  "source",
  "tests",
  "docs",
  "generated",
  "operational",
  "assets",
  "config",
  "other",
];

export function compactFiles(files: string[], sampleSize = 12): FileListSummary {
  return {
    count: files.length,
    sample: files.slice(0, sampleSize),
    hidden: Math.max(0, files.length - sampleSize),
  };
}

export function isVolatileForgeState(file: string): boolean {
  const lower = file.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  return (
    lower.startsWith(".forge/locks/") ||
    lower.startsWith(".forge/pglite/") ||
    lower.startsWith(".forge/pglite.backups/") ||
    lower.startsWith(".forge/runtime-cache/") ||
    lower.startsWith(".forge/test-runs/") ||
    lower.startsWith(".forge/ui-runs/") ||
    lower.startsWith(".forge/local/") ||
    lower.endsWith("/postmaster.pid") ||
    lower.endsWith("/.s.pgsql.5432.lock") ||
    lower.endsWith("/.s.pgsql.5432.lock.out")
  );
}

export function filterVolatileForgeState(files: string[]): string[] {
  return files.filter((file) => !isVolatileForgeState(file));
}

export function classifyChangeType(file: string): ChangeType {
  const normalized = file.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const basename = lower.split("/").pop() ?? lower;

  if (
    lower.startsWith("src/forge/_generated/") ||
    lower === "forge.lock" ||
    lower.endsWith("/forge.lock")
  ) {
    return "generated";
  }
  if (lower === ".codex/hooks.json") {
    return "config";
  }
  if (
    lower.startsWith(".forge/") ||
    lower.startsWith(".codex/") ||
    lower.startsWith(".claude/") ||
    lower.startsWith(".cursor/") ||
    lower.startsWith(".vscode/") ||
    lower.endsWith(".log") ||
    lower.endsWith(".pid")
  ) {
    return "operational";
  }
  if (
    lower === "readme.md" ||
    lower === "agents.md" ||
    lower === "claude.md" ||
    lower.startsWith("docs/") ||
    lower.endsWith(".md") ||
    lower.endsWith(".mdx")
  ) {
    return "docs";
  }
  if (
    lower.startsWith("tests/") ||
    lower.startsWith("test/") ||
    lower.includes("/__tests__/") ||
    /\.test\.[cm]?[jt]sx?$/.test(lower) ||
    /\.spec\.[cm]?[jt]sx?$/.test(lower)
  ) {
    return "tests";
  }
  if (
    lower.startsWith("marketing/") ||
    lower.startsWith("public/") ||
    lower.startsWith("assets/") ||
    lower.startsWith("static/") ||
    /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov|ico|pdf)$/i.test(lower)
  ) {
    return "assets";
  }
  if (
    basename === "package.json" ||
    basename === "bun.lock" ||
    basename === "package-lock.json" ||
    basename === "pnpm-lock.yaml" ||
    basename === "yarn.lock" ||
    basename.startsWith("tsconfig") ||
    basename.startsWith("vite.config") ||
    basename.startsWith("next.config") ||
    basename.startsWith("nuxt.config") ||
    basename.startsWith("eslint.config") ||
    basename === "mkdocs.yml" ||
    basename === "mkdocs.yaml" ||
    basename.startsWith("biome") ||
    basename.startsWith("vitest.config")
  ) {
    return "config";
  }
  if (
    lower.startsWith("src/") ||
    lower.startsWith("web/") ||
    lower.startsWith("templates/") ||
    lower.startsWith("examples/") ||
    lower.startsWith("bin/")
  ) {
    return "source";
  }
  return "other";
}

export function categorizeFiles(
  files: string[],
  sampleSize = 8,
  classify: ChangeClassifier = classifyChangeType,
): CategorizedFileSummary {
  const sorted = [...files].sort();
  const groups = Object.fromEntries(
    CHANGE_TYPES.map((type) => [type, [] as string[]]),
  ) as Record<ChangeType, string[]>;
  for (const file of sorted) {
    groups[classify(file)].push(file);
  }
  const byType = Object.fromEntries(
    CHANGE_TYPES.map((type) => [type, compactFiles(groups[type], sampleSize)]),
  ) as Record<ChangeType, FileListSummary>;
  const primaryTypes = CHANGE_TYPES
    .filter((type) => byType[type].count > 0)
    .sort((left, right) => byType[right].count - byType[left].count);
  return {
    total: compactFiles(sorted, sampleSize),
    byType,
    primaryTypes,
  };
}

export function summarizeChangeTypes(summary: CategorizedFileSummary): string {
  return summary.primaryTypes
    .slice(0, 5)
    .map((type) => `${summary.byType[type].count} ${type}`)
    .join(", ");
}

export function buildDiffPlanFromChangeSummary(summary: CategorizedFileSummary): DiffPlan {
  const generatedFiles = summary.byType.generated.count;
  const authoredFiles = Math.max(0, summary.total.count - generatedFiles);
  return {
    first: "authored",
    then: "generated",
    generatedCollapsedByDefault: generatedFiles > 0,
    generatedFiles,
    authoredFiles,
    authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
    generatedDiffCommand: "git diff -- src/forge/_generated forge.lock",
    fullDiffCommand: "git diff",
    summary: generatedFiles > 0
      ? `${authoredFiles} authored file(s) first; ${generatedFiles} generated artifact(s) are derived and should be reviewed after the source cause.`
      : `${authoredFiles} authored file(s); no generated artifacts changed.`,
  };
}
