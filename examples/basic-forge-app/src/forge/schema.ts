import { defineTable } from "forge/server";

export const organizations = defineTable({
  name: "organizations",
  fields: {
    id: "uuid",
    name: "text",
  },
});

export const tickets = defineTable({
  name: "tickets",
  fields: {
    id: "uuid",
    tenantId: "ref:organizations",
    title: "text",
    status: "enum:open,pending,closed",
    createdAt: "timestamp",
  },
});
