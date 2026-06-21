import { can, command } from "forge/server";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export const openWorkroom = command({
  auth: can("workroom.write"),
  handler: async (ctx, args) => {
    const input = args as {
      appName?: unknown;
      appPath?: unknown;
      previewUrl?: unknown;
      previewStatus?: unknown;
      previewStatusReason?: unknown;
      agent?: unknown;
      objective?: unknown;
      generatedState?: unknown;
      generatedChangedFiles?: unknown;
      authoredFiles?: unknown;
      generatedFiles?: unknown;
      authoredDiffCommand?: unknown;
      generatedDiffCommand?: unknown;
      terminalCommand?: unknown;
      terminalCwd?: unknown;
    };
    const now = new Date().toISOString();
    const session = await ctx.db.agentSessions.insert({
      appName: text(input.appName, "__FORGE_APP_TITLE__"),
      appPath: text(input.appPath, "."),
      previewUrl: text(input.previewUrl, "http://127.0.0.1:5174"),
      previewStatus: text(input.previewStatus, "not-checked"),
      previewStatusReason: text(input.previewStatusReason, "Preview has not been probed yet."),
      agent: text(input.agent, "codex"),
      status: "observing",
      objective: text(input.objective, "External agent development session"),
      generatedState: text(input.generatedState, "fresh"),
      generatedChangedFiles: count(input.generatedChangedFiles),
      authoredFiles: count(input.authoredFiles),
      generatedFiles: count(input.generatedFiles),
      authoredDiffCommand: text(input.authoredDiffCommand, 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"'),
      generatedDiffCommand: text(input.generatedDiffCommand, "git diff -- src/forge/_generated forge.lock"),
      terminalCommand: text(input.terminalCommand, "codex"),
      terminalCwd: text(input.terminalCwd, "."),
      createdAt: now,
      updatedAt: now,
    });

    await ctx.emit("workroom.opened", {
      sessionId: session.id,
      appName: session.appName,
      agent: session.agent,
    });

    return session;
  },
});
