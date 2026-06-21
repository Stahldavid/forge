import { canRole, definePolicies } from "forge/policy";

export const policies = definePolicies({
  "workroom.read": canRole("owner", "admin", "member"),
  "workroom.write": canRole("owner", "admin", "member"),
});
