import { join } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";

export function shouldUseLocalForgeCli(workspaceRoot: string): boolean {
  return nodeFileSystem.exists(join(workspaceRoot, "bin", "forge.mjs"));
}

export function forgeCliCommandForWorkspace(workspaceRoot: string, command: string): string {
  return shouldUseLocalForgeCli(workspaceRoot) ? command.replace(/^forge\b/, "node bin/forge.mjs") : command;
}

export function forgeCliCommandsForWorkspace(workspaceRoot: string, commands: string[]): string[] {
  return commands.map((command) => forgeCliCommandForWorkspace(workspaceRoot, command));
}
