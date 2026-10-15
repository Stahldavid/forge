import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProgramError } from "./program-contract.ts";

export interface ProgramRuntimeOptions { ownerCapacity?: number; ownerMaxTokens?: number }

/** Owner configuration is local trusted configuration, never a workflow request override. */
export function readProgramRuntimeOptions(root: string): ProgramRuntimeOptions {
  const directory = join(root, ".forge"), path = join(directory, "fabric-runtime.json");
  if (lstatSync(directory, { throwIfNoEntry: false })?.isSymbolicLink()) throw new ProgramError("AF_PROGRAM_INVALID", "Runtime configuration directory cannot be a symbolic link");
  const stat = lstatSync(path, { throwIfNoEntry: false });
  if (!stat) return {};
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024) throw new ProgramError("AF_PROGRAM_INVALID", "Runtime configuration must be a regular file up to 16 KiB");
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ProgramError("AF_PROGRAM_INVALID", "Runtime configuration must be an object");
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || Object.keys(record).some(key => !["schemaVersion", "ownerCapacity", "ownerMaxTokens"].includes(key))) throw new ProgramError("AF_PROGRAM_INVALID", "Unsupported runtime configuration");
  for (const key of ["ownerCapacity", "ownerMaxTokens"] as const) {
    const number = record[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1 || (key === "ownerCapacity" && number > 32))) throw new ProgramError("AF_PROGRAM_INVALID", `Invalid ${key}`);
  }
  return { ownerCapacity: record.ownerCapacity as number | undefined, ownerMaxTokens: record.ownerMaxTokens as number | undefined };
}
