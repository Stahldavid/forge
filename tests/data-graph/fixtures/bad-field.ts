import { defineTable } from "forge/server";

export const bad = defineTable({
  name: "bad",
  fields: { value: "enum:" },
});
