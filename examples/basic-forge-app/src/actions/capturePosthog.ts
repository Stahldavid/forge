import { action } from "forge/server";
import { posthogServer } from "../lib/posthogServer.js";

export const capturePosthog = action(async () => {
  return posthogServer;
});
