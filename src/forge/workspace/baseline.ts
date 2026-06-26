import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const WORKSPACE_BASELINE_PATH = ".forge/baseline.json";

export interface WorkspaceBaselineFile {
  hash: string;
  size: number;
}

export interface WorkspaceBaseline {
  schemaVersion: "0.1.0";
  kind: "forge-workspace-baseline";
  createdAt: string;
  reason?: string;
  files: Record<string, WorkspaceBaselineFile>;
}

export interface WorkspaceBaselineDiff {
  baseline: WorkspaceBaseline;
  added: string[];
  modified: string[];
  deleted: string[];
  changed: string[];
}

export function baselinePath(workspaceRoot: string): string {
  return join(workspaceRoot, WORKSPACE_BASELINE_PATH);
}

export function hashWorkspaceFile(workspaceRoot: string, relativePath: string): WorkspaceBaselineFile | null {
  try {
    const content = readFileSync(join(workspaceRoot, relativePath));
    return {
      hash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      size: content.byteLength,
    };
  } catch {
    return null;
  }
}

export function readWorkspaceBaseline(workspaceRoot: string): WorkspaceBaseline | null {
  const file = baselinePath(workspaceRoot);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as WorkspaceBaseline;
    if (parsed.schemaVersion !== "0.1.0" || parsed.kind !== "forge-workspace-baseline") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function createWorkspaceBaseline(input: {
  workspaceRoot: string;
  files: string[];
  reason?: string;
  now?: Date;
}): WorkspaceBaseline {
  const files: Record<string, WorkspaceBaselineFile> = {};
  for (const file of input.files) {
    const hashed = hashWorkspaceFile(input.workspaceRoot, file);
    if (hashed) {
      files[file] = hashed;
    }
  }
  return {
    schemaVersion: "0.1.0",
    kind: "forge-workspace-baseline",
    createdAt: (input.now ?? new Date()).toISOString(),
    ...(input.reason ? { reason: input.reason } : {}),
    files,
  };
}

export function writeWorkspaceBaseline(workspaceRoot: string, baseline: WorkspaceBaseline): void {
  const file = baselinePath(workspaceRoot);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}

export function diffWorkspaceBaseline(input: {
  workspaceRoot: string;
  baseline: WorkspaceBaseline;
  files: string[];
}): WorkspaceBaselineDiff {
  const current = new Set(input.files);
  const baselineFiles = new Set(Object.keys(input.baseline.files));
  const added = [...current].filter((file) => !baselineFiles.has(file)).sort();
  const deleted = [...baselineFiles].filter((file) => !current.has(file)).sort();
  const modified = [...current]
    .filter((file) => baselineFiles.has(file))
    .filter((file) => {
      const hashed = hashWorkspaceFile(input.workspaceRoot, file);
      return !hashed || hashed.hash !== input.baseline.files[file]?.hash;
    })
    .sort();
  const changed = [...new Set([...added, ...modified, ...deleted])].sort();
  return {
    baseline: input.baseline,
    added,
    modified,
    deleted,
    changed,
  };
}
