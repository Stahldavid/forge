import { canRole, definePolicies } from "forge/policy";

export const policies = definePolicies({
  "tickets.read": canRole("owner", "admin", "member"),
  "tickets.create": canRole("owner", "admin", "member"),
  "billing.manage": canRole("owner", "admin"),
});
