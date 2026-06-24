import { can, query } from "forge/server";

export const listNotes = query({
  auth: can("notes.read"),
  handler: async (ctx) => {
    return ctx.db.notes.all();
  },
});
