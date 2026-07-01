import { canPermission, definePolicies } from "forge/policy";

export const policies = definePolicies({
  "demo:seed": canPermission("demo:seed"),
  "vendors:read": canPermission("vendors:read"),
  "vendors:manage": canPermission("vendors:manage"),
  "access:request": canPermission("access:request"),
  "access:approve": canPermission("access:approve"),
  "evidence:manage": canPermission("evidence:manage"),
  "audit:read": canPermission("audit:read"),
});
