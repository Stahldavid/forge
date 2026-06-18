import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ForgeCommand } from "../cli/parse.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import { hashUtf8Bytes } from "../compiler/primitives/hash.ts";
import { DeltaStore, type DeltaRuntimeCallInput } from "./store.ts";
import { classifyArtifactKind } from "./classifier.ts";
import { readDeltaGitSnapshot } from "./git-observer.ts";

export interface AmbientDeltaRecorder {
  sessionId?: string;
  recordRuntimeCall(input: DeltaRuntimeCallInput & { diagnostics?: unknown[] }): Promise<void>;
  recordAgentTool(input: { toolName: string; risk?: string; status: "completed" | "failed"; traceId?: string; durationMs?: number }): Promise<void>;
  recordFileChanged(path: string, changeType?: "created" | "modified" | "deleted" | "renamed" | "generated"): Promise<void>;
  close(summary?: string): Promise<void>;
}

export function isDeltaDisabled(argv: string[] = process.argv.slice(2)): boolean {
  return argv.includes("--no-delta") || process.env.FORGE_DELTA === "0";
}

export async function createAmbientDeltaRecorder(
  workspaceRoot: string,
  source: "forge-dev" | "forge-command" | "auto",
  summary?: string,
): Promise<AmbientDeltaRecorder> {
  if (isDeltaDisabled()) {
    return noopRecorder;
  }
  try {
    const store = await DeltaStore.open(workspaceRoot);
    const actorId = await store.ensureActor("forge", "forge-cli", { pid: process.pid });
    const sessionId = await store.createSession({
      source,
      summary,
      metadata: { actorId },
      git: readDeltaGitSnapshot(workspaceRoot),
    });
    return {
      sessionId,
      async recordRuntimeCall(input) {
        await safeDelta(async () => {
          const failedCode = input.diagnosticCode ?? diagnosticCode(input.diagnostics);
          await store.appendOperation({
            sessionId,
            actorId,
            kind: input.result === "denied"
              ? "runtime.entry.denied"
              : input.result === "failed"
                ? "runtime.entry.failed"
                : "runtime.entry.executed",
            summary: `${input.entryName} ${input.result ?? "executed"}`,
            data: {
              entryName: input.entryName,
              entryKind: input.entryKind,
              result: input.result,
              traceId: input.traceId,
              diagnosticCode: failedCode,
            },
            runtimeCall: { ...input, diagnosticCode: failedCode },
          });
        });
      },
      async recordAgentTool(input) {
        await safeDelta(async () => {
          await store.appendOperation({
            sessionId,
            actorId,
            kind: "agent.tool.called",
            summary: `${input.toolName} ${input.status}`,
            data: {
              toolName: input.toolName,
              risk: input.risk,
              status: input.status,
              traceId: input.traceId,
              durationMs: input.durationMs,
            },
          });
        });
      },
      async recordFileChanged(path, changeType = "modified") {
        await safeDelta(() => store.recordFilePath(sessionId, path, changeType));
      },
      async close(closeSummary) {
        await safeDelta(async () => {
          await store.endSession(sessionId, closeSummary);
          await store.close();
        });
      },
    };
  } catch {
    return noopRecorder;
  }
}

export async function recordParsedCliCommand(input: {
  command: ForgeCommand;
  argv: string[];
  exitCode: number;
  durationMs: number;
}): Promise<void> {
  if (
    isDeltaDisabled(input.argv) ||
    input.command.kind === "delta" ||
    input.command.kind === "session" ||
    input.command.kind === "timeline" ||
    input.command.kind === "explain"
  ) {
    return;
  }
  await safeDelta(async () => {
    const workspaceRoot = commandWorkspaceRoot(input.command);
    const store = await DeltaStore.open(workspaceRoot);
    const actorId = await store.ensureActor("forge", "forge-cli", { pid: process.pid });
    const sessionId = await store.createSession({
      source: "forge-command",
      summary: `forge ${input.command.kind}`,
      metadata: { argv: input.argv },
      git: readDeltaGitSnapshot(workspaceRoot),
    });
    const commandName = commandDisplayName(input.command);
    const exitKind = input.exitCode === 0 ? "forge.command.completed" : "forge.command.failed";
    const data = {
      command: commandName,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
      git: readDeltaGitSnapshot(workspaceRoot),
    };
    await store.appendOperation({
      sessionId,
      actorId,
      kind: exitKind,
      summary: `${commandName} ${input.exitCode === 0 ? "completed" : "failed"}`,
      data,
      commandRun: {
        commandName,
        argv: input.argv,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
      },
    });

    await recordSpecializedCommand(store, sessionId, actorId, input.command, input.exitCode, commandName);
    await store.endSession(sessionId, `forge ${input.command.kind} exited ${input.exitCode}`);
    await store.close();
  });
}

async function recordSpecializedCommand(
  store: DeltaStore,
  sessionId: string,
  actorId: string,
  command: ForgeCommand,
  exitCode: number,
  commandName: string,
): Promise<void> {
  if (command.kind === "generate" && exitCode === 0) {
    const artifacts = listGeneratedArtifacts(process.cwd()).map((path) => ({
      path,
      artifactKind: classifyArtifactKind(path),
      generated: true,
      hash: hashFileIfPresent(process.cwd(), path),
    }));
    await store.appendOperation({
      sessionId,
      actorId,
      kind: "artifact.generated",
      summary: `Generated ${artifacts.length} Forge artifacts`,
      data: { count: artifacts.length, generator: "forge generate" },
      artifacts,
    });
    return;
  }

  if (command.kind === "manifest") {
    await store.appendOperation({
      sessionId,
      actorId,
      kind: command.subcommand === "import" ? "manifest.imported" : "manifest.validated",
      summary: `${command.subcommand} ${command.path}`,
      data: { path: command.path, subcommand: command.subcommand, exitCode },
      artifacts: command.subcommand === "import"
        ? ["externalServices.json", "agentContract.json", "api.json"].map((name) => ({
            path: `${GENERATED_DIR}/${name}`,
            generated: true,
          }))
        : undefined,
    });
    return;
  }

  if (command.kind === "run" && command.name) {
    const queryMode = command.queryMode === true;
    await store.appendOperation({
      sessionId,
      actorId,
      kind: exitCode === 0 ? "runtime.entry.executed" : "runtime.entry.failed",
      summary: `${command.name} ${exitCode === 0 ? "success" : "failed"}`,
      data: { entryName: command.name, entryKind: queryMode ? "query" : "command", exitCode },
      runtimeCall: {
        entryName: command.name,
        entryKind: queryMode ? "query" : "command",
        result: exitCode === 0 ? "success" : "failed",
      },
    });
    return;
  }

  if (command.kind === "query" && command.subcommand === "run" && command.name) {
    await store.appendOperation({
      sessionId,
      actorId,
      kind: exitCode === 0 ? "runtime.entry.executed" : "runtime.entry.failed",
      summary: `${command.name} ${exitCode === 0 ? "success" : "failed"}`,
      data: { entryName: command.name, entryKind: "query", exitCode },
      runtimeCall: {
        entryName: command.name,
        entryKind: "query",
        result: exitCode === 0 ? "success" : "failed",
      },
    });
    return;
  }

  if (command.kind === "security" && command.subcommand === "prove") {
    await store.appendOperation({
      sessionId,
      actorId,
      kind: "proof.run",
      summary: `security prove ${exitCode === 0 ? "passed" : "failed"}`,
      data: { command: commandName, exitCode },
      proof: {
        proofKind: "security-prove",
        command: commandName,
        result: exitCode === 0 ? "passed" : "failed",
      },
    });
    return;
  }

  if (command.kind === "ai" && command.subcommand === "redteam") {
    await store.appendOperation({
      sessionId,
      actorId,
      kind: "proof.run",
      summary: `ai redteam ${exitCode === 0 ? "passed" : "failed"}`,
      data: { command: commandName, exitCode },
      proof: {
        proofKind: "ai-redteam",
        command: commandName,
        result: exitCode === 0 ? "passed" : "failed",
      },
    });
    return;
  }

  if (command.kind === "check" || command.kind === "verify") {
    await store.appendOperation({
      sessionId,
      actorId,
      kind: "proof.run",
      summary: `${commandName} ${exitCode === 0 ? "passed" : "failed"}`,
      data: { command: commandName, exitCode },
      proof: {
        proofKind: command.kind === "check" ? "forge-check" : "forge-verify",
        command: commandName,
        result: exitCode === 0 ? "passed" : "failed",
      },
    });
  }
}

const noopRecorder: AmbientDeltaRecorder = {
  async recordRuntimeCall() {},
  async recordAgentTool() {},
  async recordFileChanged() {},
  async close() {},
};

async function safeDelta(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Delta recording is ambient. It must never change primary command behavior.
  }
}

function diagnosticCode(diagnostics: unknown[] | undefined): string | undefined {
  const first = diagnostics?.find((diagnostic) =>
    diagnostic && typeof diagnostic === "object" && "code" in diagnostic,
  ) as { code?: unknown } | undefined;
  return typeof first?.code === "string" ? first.code : undefined;
}

function commandWorkspaceRoot(command: ForgeCommand): string {
  if ("workspaceRoot" in command && typeof command.workspaceRoot === "string") {
    return command.workspaceRoot;
  }
  if ("options" in command && command.options && typeof command.options === "object" && "workspaceRoot" in command.options) {
    const root = (command.options as { workspaceRoot?: unknown }).workspaceRoot;
    if (typeof root === "string") {
      return root;
    }
  }
  return process.cwd().replace(/\\/g, "/");
}

function commandDisplayName(command: ForgeCommand): string {
  if ("subcommand" in command && typeof command.subcommand === "string") {
    return `forge ${command.kind} ${command.subcommand}`;
  }
  if ("options" in command && command.options && typeof command.options === "object" && "subcommand" in command.options) {
    const subcommand = (command.options as { subcommand?: unknown }).subcommand;
    if (typeof subcommand === "string") {
      return `forge ${command.kind} ${subcommand}`;
    }
  }
  return `forge ${command.kind}`;
}

function listGeneratedArtifacts(workspaceRoot: string): string[] {
  const root = join(workspaceRoot, GENERATED_DIR);
  try {
    return walk(root).map((path) => normalizePath(relative(workspaceRoot, path)));
  } catch {
    return [];
  }
}

function walk(root: string): string[] {
  const entries: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      entries.push(...walk(path));
    } else if (entry.isFile()) {
      entries.push(path);
    }
  }
  return entries;
}

function hashFileIfPresent(workspaceRoot: string, path: string): string | undefined {
  try {
    return hashUtf8Bytes(readFileSync(join(workspaceRoot, path)));
  } catch {
    return undefined;
  }
}
