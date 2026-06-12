import { canRole, definePolicies } from "forge/policy";

export const policies = definePolicies({
  "notes.read": canRole("owner", "admin", "member"),
  "notes.create": canRole("owner", "admin", "member"),
});
