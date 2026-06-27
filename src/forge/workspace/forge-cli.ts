import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";

export function shouldUseLocalForgeCli(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, "bin", "forge.mjs"));
}

export function forgeCliCommandForWorkspace(workspaceRoot: string, command: string): string {
  return shouldUseLocalForgeCli(workspaceRoot) ? command.replace(/^forge(?=\s|$)/, "node bin/forge.mjs") : command;
}

export function forgeCliCommandsForWorkspace(workspaceRoot: string, commands: string[]): string[] {
  return commands.map((command) => forgeCliCommandForWorkspace(workspaceRoot, command));
}

function isProseField(key: string | undefined): boolean {
  return Boolean(
    key &&
      /^(message|reason|summary|detail|details|description|note|evidence|fixHint|generatorCheckMeaning|gitMeaning|skippedReason|error)$/i.test(key),
  );
}

export function normalizeForgeCliCommandsInValue<T>(workspaceRoot: string, value: T, key?: string): T {
  if (!shouldUseLocalForgeCli(workspaceRoot)) {
    return value;
  }
  if (typeof value === "string") {
    return isProseField(key) ? value : forgeCliCommandForWorkspace(workspaceRoot, value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForgeCliCommandsInValue(workspaceRoot, item, key)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizeForgeCliCommandsInValue(workspaceRoot, item, key),
      ]),
    ) as T;
  }
  return value;
}
