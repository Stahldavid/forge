import { lstatSync } from "node:fs";
import { join } from "node:path";
import { AgentFabricError } from "./errors.ts";

/** Check each local state component before opening files or creating worktrees. */
export function localFabricPath(repositoryRoot: string, ...parts: string[]): string {
  let current = repositoryRoot;
  for (const part of [".forge", "local", "agent-fabric", ...parts]) {
    if (!/^[A-Za-z0-9._-]+$/u.test(part) || part === "." || part === "..") {
      throw new AgentFabricError("AF_INVALID_STATE", "Invalid local Agent Fabric path component");
    }
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink()) {
      throw new AgentFabricError("AF_INVALID_STATE", "Local Agent Fabric path traverses a symbolic link");
    }
  }
  return current;
}
