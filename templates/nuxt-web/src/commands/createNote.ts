import { can, command } from "forge/server";

export const createNote = command({
  auth: can("notes.create"),
  handler: async (ctx, args) => {
    const input = args as { title?: unknown; body?: unknown };
    const title = typeof input.title === "string" ? input.title.trim() : "";
    if (!title) {
      throw new Error("title is required");
    }

    const note = await ctx.db.notes.insert({
      title,
      body: typeof input.body === "string" ? input.body : "",
      status: "open",
      createdAt: new Date().toISOString(),
    });

    await ctx.emit("note.created", {
      id: note.id,
      title: note.title,
    });

    return note;
  },
});
