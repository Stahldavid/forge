import { action } from "forge/server";

export const logNoteCreated = action({
  event: "note.created",
  handler: async (_ctx, event) => {
    return {
      ok: true,
      event,
    };
  },
});
