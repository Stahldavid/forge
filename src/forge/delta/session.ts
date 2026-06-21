import { DeltaStore, type DeltaWorkSessionDetails, type DeltaWorkSessionSummary } from "./store.ts";

export type DeltaSessionSubcommand = "list" | "show" | "rename" | "merge" | "split" | "detach";

export interface DeltaSessionCommandInput {
  workspaceRoot: string;
  subcommand: DeltaSessionSubcommand;
  sessionId?: string;
  title?: string;
  sourceSessionId?: string;
  operationId?: string;
  limit?: number;
}

export interface DeltaSessionCommandResult {
  ok: boolean;
  subcommand: DeltaSessionSubcommand;
  sessions?: DeltaWorkSessionSummary[];
  session?: DeltaWorkSessionDetails;
  detached?: boolean;
  message?: string;
  exitCode: number;
}

export async function runDeltaSessionCommand(input: DeltaSessionCommandInput): Promise<DeltaSessionCommandResult> {
  const readOnly = input.subcommand === "list" || input.subcommand === "show";
  const store = await DeltaStore.open(input.workspaceRoot, { access: readOnly ? "read" : "write" });
  try {
    switch (input.subcommand) {
      case "list":
        return {
          ok: true,
          subcommand: input.subcommand,
          sessions: await store.listWorkSessions(input.limit),
          exitCode: 0,
        };
      case "show": {
        const session = await store.getWorkSessionDetails(input.sessionId ?? "current");
        return session
          ? { ok: true, subcommand: input.subcommand, session, exitCode: 0 }
          : { ok: false, subcommand: input.subcommand, message: "work session not found", exitCode: 1 };
      }
      case "rename": {
        if (!input.title) {
          return { ok: false, subcommand: input.subcommand, message: "forge session rename requires a title", exitCode: 1 };
        }
        const session = await store.renameWorkSession(input.sessionId ?? "current", input.title);
        return session
          ? { ok: true, subcommand: input.subcommand, session, exitCode: 0 }
          : { ok: false, subcommand: input.subcommand, message: "work session not found", exitCode: 1 };
      }
      case "merge": {
        if (!input.sourceSessionId) {
          return { ok: false, subcommand: input.subcommand, message: "forge session merge requires a source session", exitCode: 1 };
        }
        const session = await store.mergeWorkSessions(input.sessionId ?? "current", input.sourceSessionId);
        return session
          ? { ok: true, subcommand: input.subcommand, session, exitCode: 0 }
          : { ok: false, subcommand: input.subcommand, message: "work session merge failed", exitCode: 1 };
      }
      case "split": {
        if (!input.operationId) {
          return { ok: false, subcommand: input.subcommand, message: "forge session split requires an operation id", exitCode: 1 };
        }
        const session = await store.splitWorkSession(input.sessionId ?? "current", input.operationId);
        return session
          ? { ok: true, subcommand: input.subcommand, session, exitCode: 0 }
          : { ok: false, subcommand: input.subcommand, message: "work session split failed", exitCode: 1 };
      }
      case "detach": {
        if (!input.operationId) {
          return { ok: false, subcommand: input.subcommand, message: "forge session detach requires an operation id", exitCode: 1 };
        }
        const detached = await store.detachWorkSessionOperation(input.operationId);
        return { ok: detached, subcommand: input.subcommand, detached, exitCode: detached ? 0 : 1 };
      }
    }
  } finally {
    await store.close();
  }
}

export function formatDeltaSessionHuman(result: DeltaSessionCommandResult): string {
  if (!result.ok) {
    return `${result.message ?? "session command failed"}\n`;
  }
  if (result.sessions) {
    const lines = ["Work Sessions", ""];
    if (result.sessions.length === 0) {
      lines.push("none");
    } else {
      for (const session of result.sessions) {
        lines.push(`${session.id} ${session.status} ${session.confidence.toFixed(2)} ${session.title}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
  if (result.session) {
    return formatWorkSessionDetails(result.session);
  }
  if (result.detached !== undefined) {
    return result.detached ? "operation detached\n" : "operation was not linked\n";
  }
  return "session ok\n";
}

export function formatDeltaSessionJson(result: DeltaSessionCommandResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatWorkSessionDetails(session: DeltaWorkSessionDetails): string {
  const lines = ["Work Session", ""];
  lines.push(`id: ${session.id}`);
  lines.push(`title: ${session.title}`);
  lines.push(`status: ${session.status}`);
  lines.push(`confidence: ${session.confidence.toFixed(2)}`);
  if (session.gitBranch) {
    lines.push(`branch: ${session.gitBranch}`);
  }
  if (session.summary) {
    lines.push(`summary: ${session.summary}`);
  }
  lines.push("");
  lines.push("Why:");
  if (session.reasons.length === 0) {
    lines.push("  no stored signals");
  } else {
    for (const reason of session.reasons.slice(0, 8)) {
      lines.push(`  - ${reason.signal}${reason.value ? `: ${reason.value}` : ""} (${reason.weight})`);
    }
  }
  lines.push("");
  lines.push("Operations:");
  if (session.operations.length === 0) {
    lines.push("  none");
  } else {
    for (const operation of session.operations.slice(-12)) {
      lines.push(`  ${operation.timestamp.slice(11, 16)} ${operation.kind}${operation.summary ? ` ${operation.summary}` : ""}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
