import { defineTable } from "forge/server";

export const organizations = defineTable({
  name: "organizations",
  fields: {
    id: "uuid",
    name: "text",
    slug: "text",
    plan: "text",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});

export const vendors = defineTable({
  name: "vendors",
  fields: {
    id: "uuid",
    tenantId: "ref:organizations",
    name: "text",
    category: "text",
    riskTier: "text",
    ownerEmail: "text",
    status: "text",
    lastReviewAt: "timestamp",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});

export const accessRequests = defineTable({
  name: "access_requests",
  fields: {
    id: "uuid",
    tenantId: "ref:organizations",
    vendorId: "ref:vendors",
    requesterEmail: "text",
    system: "text",
    businessJustification: "text",
    status: "text",
    reviewedBy: "text",
    reviewedAt: "timestamp?",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});

export const evidenceItems = defineTable({
  name: "evidence_items",
  fields: {
    id: "uuid",
    tenantId: "ref:organizations",
    vendorId: "ref:vendors",
    label: "text",
    status: "text",
    source: "text",
    collectedAt: "timestamp",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});

export const auditEvents = defineTable({
  name: "audit_events",
  fields: {
    id: "uuid",
    tenantId: "ref:organizations",
    actorEmail: "text",
    action: "text",
    target: "text",
    detail: "text",
    createdAt: "timestamp",
  },
});
