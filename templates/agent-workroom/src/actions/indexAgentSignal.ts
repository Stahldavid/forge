import { action } from "forge/server";

export const indexAgentSignal = action({
  event: "agent.signal.recorded",
  handler: async (_ctx, event) => ({
    ok: true,
    indexed: true,
    event,
  }),
});
