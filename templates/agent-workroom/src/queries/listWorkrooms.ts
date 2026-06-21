import { can, query } from "forge/server";

export const listWorkrooms = query({
  auth: can("workroom.read"),
  handler: async (ctx) => {
    const sessions = await ctx.db.agentSessions.all();
    return sessions
      .slice()
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  },
});
