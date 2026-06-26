export type PolicyDefinition =
  | { kind: "roles"; roles: string[] }
  | { kind: "permissions"; permissions: string[] }
  | { kind: "public" }
  | { kind: "system" };

export type AuthRequirement =
  | { kind: "policy"; policy: string }
  | { kind: "public" }
  | { kind: "system" }
  | { kind: "user" };

export function canRole(...roles: string[]): PolicyDefinition {
  return { kind: "roles", roles: [...roles] };
}

export function canPermission(...permissions: string[]): PolicyDefinition {
  return { kind: "permissions", permissions: [...permissions] };
}

export function can(policy: string): AuthRequirement {
  return { kind: "policy", policy };
}

export function public_(): AuthRequirement {
  return { kind: "public" };
}

export function system(): AuthRequirement {
  return { kind: "system" };
}

export function definePolicies<T extends Record<string, PolicyDefinition>>(
  policies: T,
): T {
  return policies;
}
