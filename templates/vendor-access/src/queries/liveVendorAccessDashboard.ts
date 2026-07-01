import { can, liveQuery } from "forge/server";

export const liveVendorAccessDashboard = liveQuery({
  auth: can("vendors:read"),

  handler: async (ctx) => {
    const tenantId = ctx.auth?.tenantId;
    const [organization, vendors, accessRequests, evidenceItems, auditEvents] = await Promise.all([
      tenantId ? ctx.db.organizations.get(tenantId) : Promise.resolve(null),
      ctx.db.vendors.all(),
      ctx.db.accessRequests.all(),
      ctx.db.evidenceItems.all(),
      ctx.db.auditEvents.all(),
    ]);

    return {
      organizations: organization ? [organization] : [],
      vendors,
      accessRequests,
      evidenceItems,
      auditEvents,
    };
  },
});
