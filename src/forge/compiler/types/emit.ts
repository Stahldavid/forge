import type { ForgeLock } from "./lock.ts";

export interface EmitFile {
  path: string;
  content: string;
  contentHash: string;
}

export interface EmitPlan {
  files: EmitFile[];
  orphanedFiles: string[];
  lock: ForgeLock;
}

export type EmitMode = "write" | "check" | "dry-run";

export interface EmitOutcome {
  changed: string[];
  unchanged: string[];
  removed: string[];
}
