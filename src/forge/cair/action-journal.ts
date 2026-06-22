import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { CairFileChange, CairParsedAction } from "./types.ts";

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, "/");
}

export function writeCairActionJournal(
  workspaceRoot: string,
  action: CairParsedAction,
  changes: CairFileChange[],
  dryRun: boolean,
): string | undefined {
  if (dryRun || changes.every((change) => change.operation === "noop")) {
    return undefined;
  }
  const journalDir = join(workspaceRoot, ".forge", "cair", "journal");
  mkdirSync(journalDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = hashText(`${action.raw}\n${JSON.stringify(changes)}\n${stamp}`).slice(0, 10);
  const journalPath = join(journalDir, `${stamp}-${suffix}.json`);
  writeFileSync(
    journalPath,
    `${JSON.stringify({ schemaVersion: "0.5.0", action, changes, createdAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return normalizeSlashes(relative(workspaceRoot, journalPath));
}

export interface CairActionPlanRef {
  id: string;
  path: string;
}

export function writeCairActionPlan(
  workspaceRoot: string,
  action: CairParsedAction,
  changes: CairFileChange[],
): CairActionPlanRef | undefined {
  if (changes.length === 0 || changes.every((change) => change.operation === "noop")) {
    return undefined;
  }
  const planDir = join(workspaceRoot, ".forge", "cair", "plans");
  mkdirSync(planDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const suffix = hashText(`${action.raw}\n${JSON.stringify(changes)}`).slice(0, 10);
  const id = `P#${suffix}`;
  const planPath = join(planDir, `${stamp}-${suffix}.json`);
  writeFileSync(
    planPath,
    `${JSON.stringify({ schemaVersion: "0.5.0", id, action, changes, createdAt: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
  return { id, path: normalizeSlashes(relative(workspaceRoot, planPath)) };
}
