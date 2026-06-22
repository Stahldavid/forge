import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { buildWorkspaceGitSummary } from "../../src/forge/workspace/git-summary.ts";

function workspace(name: string): string {
  const root = join(tmpdir(), `${name}-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  return root;
}

function write(root: string, file: string, content: string): void {
  const absolute = join(root, file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  expect(result.status, result.stderr || result.stdout).toBe(0);
}

describe("workspace git summary", () => {
  test("returns an unavailable empty summary outside git", () => {
    const root = workspace("forge-git-summary-no-git");
    try {
      const summary = buildWorkspaceGitSummary(root);
      expect(summary.available).toBe(false);
      expect(summary.changed.count).toBe(0);
      expect(summary.changeSummary.changed.total.count).toBe(0);
      expect(summary.error).toBeTruthy();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("summarizes staged renames, unstaged edits, and untracked files", () => {
    const root = workspace("forge-git-summary");
    try {
      git(root, ["init"]);
      git(root, ["config", "user.email", "forge@example.test"]);
      git(root, ["config", "user.name", "Forge Test"]);
      write(root, "docs/old.md", "# Old\n");
      write(root, "docs/tracked.md", "# Tracked\n");
      git(root, ["add", "."]);
      git(root, ["commit", "--no-gpg-sign", "--no-verify", "-m", "baseline"]);

      git(root, ["mv", "docs/old.md", "docs/new.md"]);
      write(root, "docs/tracked.md", "# Tracked\n\nChanged\n");
      write(root, "bin/new-helper.ts", "export const ok = true;\n");

      const summary = buildWorkspaceGitSummary(root);

      expect(summary.available).toBe(true);
      expect(summary.commit).toMatch(/^[0-9a-f]{7,}$/);
      expect(summary.changed.count).toBe(3);
      expect(summary.staged.sample).toContain("docs/new.md");
      expect(summary.unstaged.sample).toContain("docs/tracked.md");
      expect(summary.untracked.sample).toContain("bin/new-helper.ts");
      expect(summary.changeSummary.changed.byType.docs.sample).toEqual([
        "docs/new.md",
        "docs/tracked.md",
      ]);
      expect(summary.changeSummary.changed.byType.source.sample).toContain("bin/new-helper.ts");
      expect(summary.changeSummary.changed.primaryTypes).toEqual(["docs", "source"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("does not classify leading-space porcelain lines as staged", () => {
    const root = workspace("forge-git-summary-unstaged-only");
    try {
      git(root, ["init"]);
      git(root, ["config", "user.email", "forge@example.test"]);
      git(root, ["config", "user.name", "Forge Test"]);
      write(root, "docs/tracked.md", "# Tracked\n");
      git(root, ["add", "."]);
      git(root, ["commit", "--no-gpg-sign", "--no-verify", "-m", "baseline"]);

      write(root, "docs/tracked.md", "# Tracked\n\nChanged\n");

      const summary = buildWorkspaceGitSummary(root);

      expect(summary.changed.sample).toContain("docs/tracked.md");
      expect(summary.staged.count).toBe(0);
      expect(summary.staged.sample).not.toContain("docs/tracked.md");
      expect(summary.unstaged.sample).toContain("docs/tracked.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
