import { command } from "forge/server";

export const charge = command(async () => {
  return { ok: true, source: "a" };
});
