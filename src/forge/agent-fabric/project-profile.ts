import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { localFabricPath } from "./local-paths.ts";
import type { ManagedRunSpec } from "./managed-run-contract.ts";

export interface FabricProjectProfile {
  schemaVersion: 1;
  maxConcurrency?: number;
  environment?: ManagedRunSpec["environment"];
  verificationCommands?: string[][];
}

/** An optional declarative profile; reading it never executes project commands. */
export async function readFabricProfile(root: string): Promise<FabricProjectProfile | null> {
  localFabricPath(root);
  const path = join(root, ".forge", "fabric.json");
  let stat;
  try { stat = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024) throw new Error("Invalid Agent Fabric project profile file");
  const value = JSON.parse(await readFile(path, "utf8")) as FabricProjectProfile;
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || Object.keys(value).some(key => !["schemaVersion", "maxConcurrency", "environment", "verificationCommands"].includes(key))) throw new Error("Invalid Agent Fabric project profile");
  if (value.maxConcurrency !== undefined && (!Number.isSafeInteger(value.maxConcurrency) || value.maxConcurrency < 1 || value.maxConcurrency > 4)) throw new Error("Profile maxConcurrency must be between 1 and 4");
  const env = value.environment;
  if (env !== undefined) {
    if (!env || typeof env !== "object" || Array.isArray(env) || Object.keys(env).some(key => !["mode", "ignoreScripts", "registry", "timeoutMs"].includes(key))) throw new Error("Invalid profile environment");
    if (env.mode !== undefined && !["auto", "none"].includes(env.mode)) throw new Error("Invalid profile environment mode");
    if (env.ignoreScripts !== undefined && typeof env.ignoreScripts !== "boolean") throw new Error("Invalid profile ignoreScripts");
    if (env.timeoutMs !== undefined && (!Number.isSafeInteger(env.timeoutMs) || env.timeoutMs < 100 || env.timeoutMs > 1800000)) throw new Error("Invalid profile environment deadline");
    if (env.registry !== undefined) {
      if (typeof env.registry !== "string") throw new Error("Invalid profile registry");
      const url = new URL(env.registry);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("Profile registry requires HTTPS without embedded credentials");
    }
  }
  if (value.verificationCommands !== undefined && (!Array.isArray(value.verificationCommands) || value.verificationCommands.length > 20 || value.verificationCommands.some(argv => !Array.isArray(argv) || !argv.length || argv.length > 40 || argv.some(arg => typeof arg !== "string" || !arg || arg.length > 4096 || arg.includes("\0"))))) throw new Error("Invalid profile verification commands");
  return value;
}

/** Explicit per-run values win. Suggested checks are never silently appended to a DAG. */
export async function applyFabricProfile(root: string, spec: Record<string, unknown>): Promise<Record<string, unknown>> {
  const profile = await readFabricProfile(root);
  if (!profile) return spec;
  const result = structuredClone(spec);
  if (profile.environment && (result.environment === undefined || (result.environment && typeof result.environment === "object" && !Array.isArray(result.environment)))) result.environment = { ...profile.environment, ...(result.environment as object ?? {}) };
  if (profile.maxConcurrency && result.workflow && typeof result.workflow === "object" && !Array.isArray(result.workflow)) {
    const workflow = result.workflow as Record<string, unknown>;
    if (workflow.limits === undefined || (workflow.limits && typeof workflow.limits === "object" && !Array.isArray(workflow.limits))) workflow.limits = { maxConcurrency: profile.maxConcurrency, ...(workflow.limits as object ?? {}) };
  }
  return result;
}
