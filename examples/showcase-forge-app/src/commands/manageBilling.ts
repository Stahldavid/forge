import { can, command } from "forge/server";

export const manageBilling = command({
  auth: can("billing.manage"),
  handler: async () => ({
    ok: true,
    message: "Only owners can manage billing.",
  }),
});
