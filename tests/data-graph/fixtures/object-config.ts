import { defineTable } from "forge/server";

export const tickets = defineTable({
  name: "tickets",
  fields: {
    status: "string",
  },
});
