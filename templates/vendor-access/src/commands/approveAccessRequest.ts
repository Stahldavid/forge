import { can, command } from "forge/server";

type ApproveAccessRequestArgs = {
  requestId: string;
  reviewerEmail: string;
  decision: "Approved" | "Rejected";
};

export const approveAccessRequest = command<ApproveAccessRequestArgs, unknown>({
  auth: can("access:approve"),

  handler: async (ctx, input: ApproveAccessRequestArgs) => {
    const tenantId = ctx.auth?.tenantId;
    const request = await ctx.db.accessRequests.get(input.requestId);
    if (!tenantId || !request) {
      throw new Error("Access request not found in the current tenant.");
    }

    const now = new Date().toISOString();
    const updated = await ctx.db.accessRequests.update(input.requestId, {
      status: input.decision,
      reviewedBy: input.reviewerEmail,
      reviewedAt: now,
      updatedAt: now,
    });

    await ctx.emit("vendor_access.reviewed", {
      requestId: input.requestId,
      decision: input.decision,
    });

    await ctx.db.auditEvents.insert({
      tenantId,
      actorEmail: input.reviewerEmail,
      action: input.decision === "Approved" ? "access.approved" : "access.rejected",
      target: String(request.system ?? input.requestId),
      detail: `Request ${input.decision.toLowerCase()}`,
      createdAt: now,
    });

    return updated;
  },
});
