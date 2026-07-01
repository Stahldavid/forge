import { can, command } from "forge/server";

type AddEvidenceArgs = {
  vendorId: string;
  label: string;
  source: string;
};

export const addEvidence = command<AddEvidenceArgs, unknown>({
  auth: can("evidence:manage"),

  handler: async (ctx, input: AddEvidenceArgs) => {
    const tenantId = ctx.auth?.tenantId;
    const vendor = await ctx.db.vendors.get(input.vendorId);
    if (!tenantId || !vendor) {
      throw new Error("Vendor not found in the current tenant.");
    }

    const now = new Date().toISOString();
    const evidence = await ctx.db.evidenceItems.insert({
      tenantId,
      vendorId: input.vendorId,
      label: input.label,
      status: "Accepted",
      source: input.source,
      collectedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.auditEvents.insert({
      tenantId,
      actorEmail: input.source,
      action: "evidence.added",
      target: String(vendor.name ?? input.vendorId),
      detail: input.label,
      createdAt: now,
    });

    return evidence;
  },
});
