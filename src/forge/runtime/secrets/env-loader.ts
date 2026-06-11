import { nodeFileSystem } from "../../compiler/fs/index.ts";
import { join } from "node:path";
import type { RuntimeEnvStore } from "./types.ts";

export interface LoadEnvFilesOptions {
  workspaceRoot: string;
  /** Additional files after defaults; later files override earlier ones (before process.env). */
  envFiles?: string[];
}

export interface LoadedEnvResult {
  store: RuntimeEnvStore;
}

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

/**
 * Load env files with precedence at resolve time:
 * process.env overrides .env.local overrides .env (defaults).
 */
export function loadEnvFiles(options: LoadEnvFilesOptions): LoadedEnvResult {
  const workspaceRoot = options.workspaceRoot.replace(/\\/g, "/");
  const defaultFiles = [".env", ".env.local"];
  const extra = options.envFiles ?? [];
  const ordered = [...defaultFiles, ...extra];

  const loadedFiles: string[] = [];
  const merged: Record<string, string> = {};

  for (const file of ordered) {
    const absolute = join(workspaceRoot, file);
    if (!nodeFileSystem.exists(absolute)) {
      continue;
    }

    loadedFiles.push(file);
    const parsed = parseEnvFile((nodeFileSystem.readText(absolute) ?? ""));
    Object.assign(merged, parsed);
  }

  const store: RuntimeEnvStore = {
    loadedFiles,
    resolve(name: string): string | undefined {
      if (process.env[name] !== undefined) {
        return process.env[name];
      }
      return merged[name];
    },
    snapshot(): Record<string, string | undefined> {
      const snapshot: Record<string, string | undefined> = { ...merged };
      for (const key of Object.keys(process.env)) {
        snapshot[key] = process.env[key];
      }
      return snapshot;
    },
  };

  return { store };
}

export function redactSecretValue(value: string): string {
  if (value.length <= 4) {
    return "***";
  }
  return `${value.slice(0, 4)}***`;
}
