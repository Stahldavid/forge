import { FORGE_POLICY_DENIED } from "../../compiler/diagnostics/codes.ts";
import type { CommandAuthBinding, PermissionMatrix, QueryAuthBinding } from "../../compiler/types/policy-registry.ts";
import type { AuthContext } from "./types.ts";

export interface PolicyEvaluationResult {
  allowed: boolean;
  code?: typeof FORGE_POLICY_DENIED;
  message?: string;
  policy?: string;
  role?: string;
}

function roleAllowed(
  matrix: PermissionMatrix,
  policy: string,
  roles: string[],
): boolean {
  const entry = matrix.entries.find((candidate) => candidate.policy === policy);
  if (!entry) {
    return false;
  }
  return roles.some((role) => entry.roles.includes(role));
}

function authRoles(auth: Extract<AuthContext, { kind: "user" }>): string[] {
  return [...new Set([...(auth.role ? [auth.role] : []), ...(auth.roles ?? [])])];
}

function primaryRole(roles: string[]): string {
  return roles[0] ?? "unknown";
}

export function evaluateCommandAuth(
  auth: AuthContext,
  binding: CommandAuthBinding | undefined,
  matrix: PermissionMatrix,
): PolicyEvaluationResult {
  return evaluateAuthRequirement(auth, binding?.auth, matrix, "command");
}

export function evaluateQueryAuth(
  auth: AuthContext,
  binding: QueryAuthBinding | undefined,
  matrix: PermissionMatrix,
): PolicyEvaluationResult {
  return evaluateAuthRequirement(auth, binding?.auth, matrix, "query");
}

function evaluateAuthRequirement(
  auth: AuthContext,
  requirement:
    | CommandAuthBinding["auth"]
    | QueryAuthBinding["auth"]
    | undefined,
  matrix: PermissionMatrix,
  entryKind: "command" | "query",
): PolicyEvaluationResult {
  const resolved = requirement ?? { kind: "public" as const };

  if (resolved.kind === "public") {
    return { allowed: true };
  }

  if (resolved.kind === "system") {
    if (auth.kind === "system") {
      return { allowed: true };
    }
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: `${entryKind} requires system auth context`,
    };
  }

  if (auth.kind === "anonymous") {
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: `${entryKind} requires authenticated user`,
    };
  }

  if (auth.kind === "system") {
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: `${entryKind} requires user auth context`,
    };
  }

  if (resolved.kind === "user") {
    return { allowed: true };
  }

  const roles = authRoles(auth);
  const allowed = roleAllowed(matrix, resolved.policy, roles);
  const role = primaryRole(roles);
  if (allowed) {
    return { allowed: true, policy: resolved.policy, role };
  }

  return {
    allowed: false,
    code: FORGE_POLICY_DENIED,
    message: `role '${role}' denied for policy '${resolved.policy}'`,
    policy: resolved.policy,
    role,
  };
}

export function simulatePolicy(
  matrix: PermissionMatrix,
  policy: string,
  role: string,
): PolicyEvaluationResult {
  const allowed = roleAllowed(matrix, policy, [role]);
  return allowed
    ? { allowed: true, policy, role }
    : {
        allowed: false,
        code: FORGE_POLICY_DENIED,
        message: `role '${role}' denied for policy '${policy}'`,
        policy,
        role,
      };
}
