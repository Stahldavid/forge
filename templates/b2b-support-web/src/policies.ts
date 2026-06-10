import { canRole, definePolicies } from "forge/policy";

export const policies = definePolicies({
  "tickets.read": canRole("owner", "admin", "member"),
  "tickets.create": canRole("owner", "admin", "member"),
  "tickets.update": canRole("owner", "admin"),
  "tickets.close": canRole("owner", "admin"),
  "billing.manage": canRole("owner"),
});
