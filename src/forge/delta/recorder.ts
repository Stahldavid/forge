import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import type { ForgeCommand } from "../cli/parse.ts";
import { GENERATED_DIR } from "../compiler/emitter/constants.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import { hashUtf8Bytes } from "../compiler/primitives/hash.ts";
import { DeltaStore, DeltaStoreBusyError, type DeltaRuntimeCallInput } from "./store.ts";
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
  let actorId: string | undefined;
  let sessionId: string | undefined;
  let accepting = true;
  let closed = false;
  let queue = Promise.resolve();

  const withStore = async (fn: (store: DeltaStore) => Promise<void>): Promise<void> => {
    const store = await openDeltaStoreWithRetry(workspaceRoot);
    try {
      await fn(store);
    } finally {
      await store.close();
    }
  };

  const enqueue = (fn: (store: DeltaStore) => Promise<void>): Promise<void> => {
    queue = queue.then(() => safeDelta(() => withStore(fn)));
    return queue;
  };

  const ensureSession = async (store: DeltaStore): Promise<{ actorId: string; sessionId: string } | null> => {
    if (actorId && sessionId) {
      return { actorId, sessionId };
    }
    actorId = await store.ensureActor("forge", "forge-cli", { pid: process.pid });
    sessionId = await store.createSession({
      source,
      summary,
      metadata: { actorId },
      git: readDeltaGitSnapshot(workspaceRoot),
    });
    return { actorId, sessionId };
  };

  await enqueue(async (store) => {
    await ensureSession(store);
  });

  return {
    get sessionId() {
      return sessionId;
    },
    async recordRuntimeCall(input) {
      if (!accepting) {
        return;
      }
      await enqueue(async (store) => {
        const session = await ensureSession(store);
        if (!session) {
          return;
        }
        const failedCode = input.diagnosticCode ?? diagnosticCode(input.diagnostics);
        await store.appendOperation({
          sessionId: session.sessionId,
          actorId: session.actorId,
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
      if (!accepting) {
        return;
      }
      await enqueue(async (store) => {
        const session = await ensureSession(store);
        if (!session) {
          return;
        }
        await store.appendOperation({
          sessionId: session.sessionId,
          actorId: session.actorId,
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
      if (!accepting) {
        return;
      }
      await enqueue(async (store) => {
        const session = await ensureSession(store);
        if (!session) {
          return;
        }
        await store.recordFilePath(session.sessionId, path, changeType);
      });
    },
    async close(closeSummary) {
      if (closed) {
        await queue;
        return;
      }
      accepting = false;
      closed = true;
      await enqueue(async (store) => {
        if (!sessionId) {
          return;
        }
        await store.endSession(sessionId, closeSummary);
      });
    },
  };
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
  const workspaceRoot = commandWorkspaceRoot(command);
  if (command.kind === "generate" && exitCode === 0) {
    const artifacts = listGeneratedArtifacts(workspaceRoot).map((path) => ({
      path,
      artifactKind: classifyArtifactKind(path),
      generated: true,
      hash: hashFileIfPresent(workspaceRoot, path),
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
    const runtimeMetadata = externalRuntimeMetadata(workspaceRoot, command.name, queryMode ? "query" : "command");
    await store.appendOperation({
      sessionId,
      actorId,
      kind: exitCode === 0 ? "runtime.entry.executed" : "runtime.entry.failed",
      summary: `${command.name} ${exitCode === 0 ? "success" : "failed"}`,
      data: { entryName: command.name, entryKind: queryMode ? "query" : "command", exitCode, ...runtimeMetadata },
      runtimeCall: {
        entryName: command.name,
        entryKind: queryMode ? "query" : "command",
        result: exitCode === 0 ? "success" : "failed",
        ...runtimeMetadata,
      },
    });
    return;
  }

  if (command.kind === "query" && command.subcommand === "run" && command.name) {
    const runtimeMetadata = externalRuntimeMetadata(workspaceRoot, command.name, "query");
    await store.appendOperation({
      sessionId,
      actorId,
      kind: exitCode === 0 ? "runtime.entry.executed" : "runtime.entry.failed",
      summary: `${command.name} ${exitCode === 0 ? "success" : "failed"}`,
      data: { entryName: command.name, entryKind: "query", exitCode, ...runtimeMetadata },
      runtimeCall: {
        entryName: command.name,
        entryKind: "query",
        result: exitCode === 0 ? "success" : "failed",
        ...runtimeMetadata,
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

  if (command.kind === "cair") {
    const cairKind = cairOperationKind(command);
    await store.appendOperation({
      sessionId,
      actorId,
      kind: cairKind,
      summary: cairSummary(command, cairKind, exitCode),
      data: {
        subcommand: command.options.subcommand,
        exitCode,
        ...(command.options.query ? { queryVerb: compactCairVerb(command.options.query) } : {}),
        ...(command.options.action ? { actionVerb: compactCairVerb(command.options.action) } : {}),
        ...(command.options.inputPath ? { inputPath: command.options.inputPath } : {}),
        dryRun: Boolean(command.options.dryRun),
        plan: Boolean(command.options.plan),
        allowGenerated: Boolean(command.options.allowGenerated),
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

function cairOperationKind(command: Extract<ForgeCommand, { kind: "cair" }>): string {
  if (command.options.subcommand === "snapshot") {
    return "cair.snapshot.created";
  }
  if (command.options.subcommand === "query") {
    return "cair.query.run";
  }
  const actionVerb = compactCairVerb(command.options.action ?? "");
  if (command.options.plan) {
    return "cair.plan.created";
  }
  if (actionVerb === "A APPLY") {
    return "cair.plan.applied";
  }
  if (command.options.dryRun) {
    return "cair.action.previewed";
  }
  return "cair.action.run";
}

function cairSummary(command: Extract<ForgeCommand, { kind: "cair" }>, kind: string, exitCode: number): string {
  const suffix = exitCode === 0 ? "completed" : "failed";
  if (command.options.subcommand === "query") {
    return `CAIR query ${compactCairVerb(command.options.query ?? "")} ${suffix}`;
  }
  if (command.options.subcommand === "action") {
    return `CAIR ${kind.replace(/^cair\./, "").replace(/\./g, " ")} ${compactCairVerb(command.options.action ?? "")} ${suffix}`;
  }
  return `CAIR snapshot ${suffix}`;
}

function compactCairVerb(input: string): string {
  const parts = input.trim().split(/\s+/u).filter(Boolean);
  if (parts.length === 0) {
    return "unknown";
  }
  return parts.slice(0, 2).join(" ");
}

const noopRecorder: AmbientDeltaRecorder = {
  async recordRuntimeCall() {},
  async recordAgentTool() {},
  async recordFileChanged() {},
  async close() {},
};

const DELTA_STORE_RETRY_DELAYS_MS = [25, 75, 150];

async function openDeltaStoreWithRetry(workspaceRoot: string): Promise<DeltaStore> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await DeltaStore.open(workspaceRoot);
    } catch (error) {
      if (!(error instanceof DeltaStoreBusyError) || attempt >= DELTA_STORE_RETRY_DELAYS_MS.length) {
        throw error;
      }
      await sleep(DELTA_STORE_RETRY_DELAYS_MS[attempt] ?? 0);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

interface ExternalServicesFile {
  services?: Array<{
    name?: unknown;
    language?: unknown;
    entries?: Array<{
      name?: unknown;
      kind?: unknown;
      risk?: unknown;
      policy?: unknown;
      tenantScoped?: unknown;
      needsApproval?: unknown;
    }>;
  }>;
}

function externalRuntimeMetadata(
  workspaceRoot: string,
  qualifiedName: string,
  kind: "command" | "query",
): Partial<DeltaRuntimeCallInput> {
  const [serviceName, ...entryParts] = qualifiedName.split(".");
  const entryName = entryParts.join(".");
  if (!serviceName || !entryName) {
    return {};
  }
  try {
    const graph = JSON.parse(
      readFileSync(join(workspaceRoot, GENERATED_DIR, "externalServices.json"), "utf8"),
    ) as ExternalServicesFile;
    const service = graph.services?.find((candidate) => candidate.name === serviceName);
    const entry = service?.entries?.find((candidate) => candidate.name === entryName && candidate.kind === kind);
    if (!service || !entry) {
      return {};
    }
    return {
      service: typeof service.name === "string" ? service.name : undefined,
      language: typeof service.language === "string" ? service.language : undefined,
      risk: typeof entry.risk === "string" ? entry.risk : undefined,
      policy: typeof entry.policy === "string" ? entry.policy : undefined,
      tenantScoped: typeof entry.tenantScoped === "boolean" ? entry.tenantScoped : undefined,
      needsApproval: typeof entry.needsApproval === "boolean" ? entry.needsApproval : undefined,
    };
  } catch {
    return {};
  }
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
