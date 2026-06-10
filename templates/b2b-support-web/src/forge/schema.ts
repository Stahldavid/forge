import { defineTable } from "forge/server";

export const tenants = defineTable({
  name: "tenants",
  fields: {
    id: "uuid",
    name: "text",
    createdAt: "timestamp",
  },
});

export const users = defineTable({
  name: "users",
  fields: {
    id: "uuid",
    tenantId: "ref:tenants",
    email: "text",
    role: "text",
    createdAt: "timestamp",
  },
});

export const tickets = defineTable({
  name: "tickets",
  fields: {
    id: "uuid",
    tenantId: "ref:tenants",
    title: "text",
    status: "text",
    severity: "text",
    triageSummary: "text",
    createdAt: "timestamp",
    updatedAt: "timestamp",
  },
});
