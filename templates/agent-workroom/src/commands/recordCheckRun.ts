import { can, command } from "forge/server";

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function duration(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export const recordCheckRun = command({
  auth: can("workroom.write"),
  handler: async (ctx, args) => {
    const input = args as {
      sessionId?: unknown;
      command?: unknown;
      status?: unknown;
      output?: unknown;
      durationMs?: unknown;
    };
    const sessionId = text(input.sessionId, "");
    if (!sessionId) {
      throw new Error("sessionId is required");
    }
    const session = await ctx.db.agentSessions.get(sessionId);
    if (!session) {
      throw new Error("session not found");
    }

    const now = new Date().toISOString();
    const run = await ctx.db.checkRuns.insert({
      sessionId,
      command: text(input.command, "forge check"),
      status: text(input.status, "passed"),
      output: text(input.output, ""),
      durationMs: duration(input.durationMs),
      createdAt: now,
    });

    await ctx.db.agentSessions.update(sessionId, {
      status: run.status === "failed" ? "needs-attention" : "verified",
      updatedAt: now,
    });
    await ctx.emit("check.run.recorded", {
      sessionId,
      runId: run.id,
      status: run.status,
    });

    return run;
  },
});
