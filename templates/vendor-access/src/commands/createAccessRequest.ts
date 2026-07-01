import { can, command } from "forge/server";

type CreateAccessRequestArgs = {
  vendorId: string;
  requesterEmail: string;
  system: string;
  businessJustification: string;
};

export const createAccessRequest = command<CreateAccessRequestArgs, unknown>({
  auth: can("access:request"),

  handler: async (ctx, input: CreateAccessRequestArgs) => {
    const tenantId = ctx.auth?.tenantId;
    const vendor = await ctx.db.vendors.get(input.vendorId);
    if (!tenantId || !vendor) {
      throw new Error("Vendor not found in the current tenant.");
    }

    const now = new Date().toISOString();
    const request = await ctx.db.accessRequests.insert({
      tenantId,
      vendorId: input.vendorId,
      requesterEmail: input.requesterEmail,
      system: input.system,
      businessJustification: input.businessJustification,
      status: "Pending",
      reviewedBy: "",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.emit("vendor_access.requested", {
      requestId: request.id,
      vendorId: input.vendorId,
    });

    await ctx.db.auditEvents.insert({
      tenantId,
      actorEmail: input.requesterEmail,
      action: "access.requested",
      target: String(vendor.name ?? input.vendorId),
      detail: input.businessJustification,
      createdAt: now,
    });

    return request;
  },
});
