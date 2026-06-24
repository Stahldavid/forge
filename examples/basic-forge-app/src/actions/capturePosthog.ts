import { action } from "forge/server";
import { createPosthogServer } from "../lib/posthogServer.js";

export const capturePosthog = action({
  handler: async (ctx) => {
    return createPosthogServer(ctx.secrets, ctx.env);
  },
});
