import type { ForgeLock } from "./lock.ts";
import type { Diagnostic } from "./diagnostic.ts";

export interface EmitFile {
  path: string;
  content: string;
  contentHash: string;
  /** Skip JSON canonicalization round-trip when content is already canonical. */
  canonical?: boolean;
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
