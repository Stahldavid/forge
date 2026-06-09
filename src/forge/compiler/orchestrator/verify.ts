import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { ForgeLock } from "../types/lock.ts";
import { createDiagnostic } from "../diagnostics/create.ts";
import { normalizePath } from "../primitives/paths.ts";

export function verifyLockIntegrity(
  workspaceRoot: string,
  lock: ForgeLock,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  for (const entry of lock.packages) {
    for (const file of entry.generatedFiles) {
      const normalized = normalizePath(file);
      if (seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);

      const absolute = join(workspaceRoot, normalized);
      if (!existsSync(absolute)) {
        diagnostics.push(
          createDiagnostic({
            severity: "error",
            code: "FORGE_LOCK_INTEGRITY",
            message: `forge.lock references missing generated file: ${normalized}`,
            file: normalized,
          }),
        );
      }
    }
  }

  return diagnostics;
}
