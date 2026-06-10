import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stripDeterministicHeader } from "../compiler/primitives/header.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import type { GenerateResult } from "../compiler/types/cli.ts";

export type AgentContractSubcommand = "generate" | "check" | "print";

export interface AgentContractCommandOptions {
  subcommand: AgentContractSubcommand;
  workspaceRoot: string;
  json: boolean;
}

export interface AgentContractPrintResult {
  data: unknown;
  exitCode: 0 | 1;
}

export function runAgentContractPrint(
  workspaceRoot: string,
): AgentContractPrintResult {
  const path = join(workspaceRoot, GENERATED_DIR, "agentContract.json");
  if (!existsSync(path)) {
    return { data: null, exitCode: 1 };
  }
  const raw = stripDeterministicHeader(readFileSync(path, "utf8"));
  return {
    data: JSON.parse(raw) as unknown,
    exitCode: 0,
  };
}

export function formatAgentContractHuman(
  subcommand: AgentContractSubcommand,
  result: GenerateResult | AgentContractPrintResult,
): string {
  if (subcommand === "print") {
    return `${JSON.stringify((result as AgentContractPrintResult).data, null, 2)}\n`;
  }
  const generated = result as GenerateResult;
  if (generated.exitCode === 0) {
    return subcommand === "check"
      ? "agent contract is up to date\n"
      : "agent contract generated\n";
  }
  return subcommand === "check"
    ? "agent contract is stale\n"
    : "agent contract generation failed\n";
}
