import { action } from "forge/server";

export const createCheckout = action(async () => {
  return { sessionId: "cs_demo" };
});
