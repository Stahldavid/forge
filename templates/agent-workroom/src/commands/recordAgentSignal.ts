import { can, command } from "forge/server";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export const recordAgentSignal = command({
  auth: can("workroom.write"),
  handler: async (ctx, args) => {
    const input = args as {
      sessionId?: unknown;
      source?: unknown;
      kind?: unknown;
      title?: unknown;
      detail?: unknown;
      filesChanged?: unknown;
      status?: unknown;
      previewStatus?: unknown;
      previewStatusReason?: unknown;
      generatedState?: unknown;
      generatedChangedFiles?: unknown;
      authoredFiles?: unknown;
      generatedFiles?: unknown;
      authoredDiffCommand?: unknown;
      generatedDiffCommand?: unknown;
      terminalCommand?: unknown;
      terminalCwd?: unknown;
    };
    let session =
      typeof input.sessionId === "string" && input.sessionId.trim().length > 0
        ? await ctx.db.agentSessions.get(input.sessionId)
        : null;
    if (!session) {
      const sessions = await ctx.db.agentSessions.all();
      session = sessions
        .slice()
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;
    }
    if (!session) {
      const createdAt = new Date().toISOString();
      session = await ctx.db.agentSessions.insert({
        appName: "__FORGE_APP_TITLE__",
        appPath: ".",
        previewUrl: "http://127.0.0.1:5174",
        previewStatus: "not-checked",
        previewStatusReason: "Preview has not been probed yet.",
        agent: "codex",
        status: "observing",
        objective: "External agent development session",
        generatedState: "fresh",
        generatedChangedFiles: 0,
        authoredFiles: 0,
        generatedFiles: 0,
        authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
        generatedDiffCommand: "git diff -- src/forge/_generated forge.lock",
        terminalCommand: "codex",
        terminalCwd: ".",
        createdAt,
        updatedAt: createdAt,
      });
    }
    if (!session) {
      throw new Error("session not found");
    }

    const now = new Date().toISOString();
    const signal = await ctx.db.agentSignals.insert({
      sessionId: session.id,
      source: text(input.source, session.agent),
      kind: text(input.kind, "hook"),
      title: text(input.title, "Agent activity recorded"),
      detail: text(input.detail, "A code agent changed the workspace."),
      filesChanged: Array.isArray(input.filesChanged)
        ? input.filesChanged.filter((file) => typeof file === "string").join(", ")
        : text(input.filesChanged, ""),
      status: text(input.status, "info"),
      createdAt: now,
    });

    const update: Record<string, unknown> = {
      status: signal.status === "error" ? "needs-attention" : "observing",
      updatedAt: now,
    };
    for (const [key, value] of Object.entries({
      previewStatus: optionalText(input.previewStatus),
      previewStatusReason: optionalText(input.previewStatusReason),
      generatedState: optionalText(input.generatedState),
      generatedChangedFiles: optionalCount(input.generatedChangedFiles),
      authoredFiles: optionalCount(input.authoredFiles),
      generatedFiles: optionalCount(input.generatedFiles),
      authoredDiffCommand: optionalText(input.authoredDiffCommand),
      generatedDiffCommand: optionalText(input.generatedDiffCommand),
      terminalCommand: optionalText(input.terminalCommand),
      terminalCwd: optionalText(input.terminalCwd),
    })) {
      if (value !== undefined) {
        update[key] = value;
      }
    }

    await ctx.db.agentSessions.update(session.id, update);
    await ctx.emit("agent.signal.recorded", {
      sessionId: session.id,
      signalId: signal.id,
      kind: signal.kind,
      status: signal.status,
    });

    return signal;
  },
});
