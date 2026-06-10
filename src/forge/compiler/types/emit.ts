import type { ForgeLock } from "./lock.ts";
import type { Diagnostic } from "./diagnostic.ts";

export interface EmitFile {
  path: string;
  content: string;
  contentHash: string;
}

export interface EmitPlan {
  files: EmitFile[];
  orphanedFiles: string[];
  lock: ForgeLock;
  diagnostics?: Diagnostic[];
}

export type EmitMode = "write" | "check" | "dry-run";

export interface EmitOutcome {
  changed: string[];
  unchanged: string[];
  removed: string[];
}
