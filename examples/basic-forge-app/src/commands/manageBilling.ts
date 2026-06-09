import { can, command } from "forge/server";

export const manageBilling = command({
  auth: can("billing.manage"),
  handler: async (ctx) => {
    return { ok: true, tenantId: ctx.auth.kind === "user" ? ctx.auth.tenantId : null };
  },
});
