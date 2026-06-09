import { defineTable } from "forge/server";

export const tenants = defineTable({
  name: "tenants",
  fields: {
    id: "uuid",
    name: "text",
  },
});

export const tickets = defineTable({
  name: "tickets",
  fields: {
    id: "uuid",
    tenantId: "ref:tenants",
    title: "text",
    status: "enum:open,pending,closed",
    createdAt: "timestamp",
  },
});
