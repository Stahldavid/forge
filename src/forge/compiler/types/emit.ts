import type { ForgeLock } from "./lock.ts";
import type { Diagnostic } from "./diagnostic.ts";

export interface EmitFile {
  path: string;
  content: string;
  contentHash: string;
  /** Skip JSON canonicalization round-trip when content is already canonical. */
  canonical?: boolean;
  /** Skip the Forge deterministic header for files whose syntax does not allow // comments. */
  header?: "deterministic" | "none";
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
