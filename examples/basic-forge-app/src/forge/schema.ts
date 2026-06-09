import { defineTable } from "forge/server";

export const tickets = defineTable({
  name: "tickets",
  fields: {
    id: "uuid",
    title: "text",
    status: "enum:open,pending,closed",
    createdAt: "timestamp",
  },
});
