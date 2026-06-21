import { can, liveQuery } from "forge/server";

type RowWithTime = {
  createdAt?: string;
  updatedAt?: string;
};

function newestFirst<T extends RowWithTime>(rows: T[]): T[] {
  return rows.slice().sort((a, b) => {
    const bTime = String(b.updatedAt ?? b.createdAt ?? "");
    const aTime = String(a.updatedAt ?? a.createdAt ?? "");
    return bTime.localeCompare(aTime);
  });
}

export const liveWorkroom = liveQuery({
  auth: can("workroom.read"),
  handler: async (ctx, args) => {
    const input = args as { sessionId?: unknown };
    const sessions = newestFirst(await ctx.db.agentSessions.all());
    const selectedSession =
      typeof input.sessionId === "string" && input.sessionId.trim().length > 0
        ? await ctx.db.agentSessions.get(input.sessionId)
        : sessions[0] ?? null;

    if (!selectedSession) {
      return {
        sessions,
        selectedSession: null,
        signals: [],
        checks: [],
        stats: {
          signalCount: 0,
          checkCount: 0,
          failingChecks: 0,
          filesTouched: 0,
        },
      };
    }

    const signals = newestFirst(await ctx.db.agentSignals.where({ sessionId: selectedSession.id }));
    const checks = newestFirst(await ctx.db.checkRuns.where({ sessionId: selectedSession.id }));
    const files = new Set(
      signals
        .flatMap((signal) => String(signal.filesChanged ?? "").split(","))
        .map((file) => file.trim())
        .filter(Boolean),
    );

    return {
      sessions,
      selectedSession,
      signals,
      checks,
      stats: {
        signalCount: signals.length,
        checkCount: checks.length,
        failingChecks: checks.filter((check) => check.status === "failed").length,
        filesTouched: files.size,
      },
    };
  },
});
