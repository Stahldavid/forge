import { can, liveQuery } from "forge/server";

export const liveNotes = liveQuery({
  auth: can("notes.read"),
  handler: async (ctx) => {
    return ctx.db.notes.all();
  },
});
