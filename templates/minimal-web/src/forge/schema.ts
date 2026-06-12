import { defineTable } from "forge/server";

export const notes = defineTable({
  name: "notes",
  fields: {
    id: "uuid",
    title: "text",
    body: "text",
    status: "text",
    createdAt: "timestamp",
  },
});
