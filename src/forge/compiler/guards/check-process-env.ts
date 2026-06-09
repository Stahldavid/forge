import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createDiagnostic } from "../diagnostics/create.ts";
import { FORGE_SECRET_DIRECT_PROCESS_ENV } from "../diagnostics/codes.ts";
import type { Diagnostic } from "../types/diagnostic.ts";
import type { SecretRegistry } from "../types/secret-registry.ts";

const PROCESS_ENV_PATTERN =
  /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[["']([A-Z][A-Z0-9_]*)["']\]/g;

const SKIP_DIRS = new Set([
  "node_modules",
  "_generated",
  ".forge",
  "dist",
  "build",
]);

function shouldScanFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("/_generated/") || normalized.startsWith("_generated/")) {
    return false;
  }
  if (normalized.includes("/src/forge/runtime/secrets/")) {
    return false;
  }
  if (normalized.includes("/src/forge/runtime/telemetry/")) {
    return false;
  }
  return normalized.endsWith(".ts") || normalized.endsWith(".tsx");
}

function collectSourceFiles(root: string, dir: string, files: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    const absolute = join(dir, entry);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) {
        continue;
      }
      collectSourceFiles(root, absolute, files);
      continue;
    }

    const rel = relative(root, absolute);
    if (shouldScanFile(rel)) {
      files.push(absolute);
    }
  }
}

export function checkDirectProcessEnvUsage(
  workspaceRoot: string,
  registry: SecretRegistry | null,
  strictSecrets: boolean,
): Diagnostic[] {
  const secretNames = new Set(registry?.secrets.map((entry) => entry.name) ?? []);
  const srcRoot = join(workspaceRoot, "src");
  const files: string[] = [];
  collectSourceFiles(workspaceRoot, srcRoot, files);

  const diagnostics: Diagnostic[] = [];
  const recorded = new Set<string>();

  for (const file of files) {
    const content = readFileSync(file, "utf8");
    let match: RegExpExecArray | null;
    PROCESS_ENV_PATTERN.lastIndex = 0;

    while ((match = PROCESS_ENV_PATTERN.exec(content)) !== null) {
      const envName = match[1] ?? match[2];
      if (!envName || !secretNames.has(envName)) {
        continue;
      }

      const key = `${file}\0${envName}\0${match.index}`;
      if (recorded.has(key)) {
        continue;
      }
      recorded.add(key);

      diagnostics.push(
        createDiagnostic({
          severity: strictSecrets ? "error" : "warning",
          code: FORGE_SECRET_DIRECT_PROCESS_ENV,
          message: `direct process.env access to secret '${envName}' — use ctx.secrets.get('${envName}') instead`,
          file: relative(workspaceRoot, file).replace(/\\/g, "/"),
          span: { start: match.index, end: match.index + match[0].length },
        }),
      );
    }
  }

  return diagnostics.sort((a, b) => (a.file ?? "").localeCompare(b.file ?? ""));
}
