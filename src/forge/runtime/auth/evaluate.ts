import { FORGE_POLICY_DENIED } from "../../compiler/diagnostics/codes.ts";
import type { CommandAuthBinding, PermissionMatrix } from "../../compiler/types/policy-registry.ts";
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
  role: string,
): boolean {
  const entry = matrix.entries.find((candidate) => candidate.policy === policy);
  if (!entry) {
    return false;
  }
  return entry.roles.includes(role);
}

export function evaluateCommandAuth(
  auth: AuthContext,
  binding: CommandAuthBinding | undefined,
  matrix: PermissionMatrix,
): PolicyEvaluationResult {
  const requirement = binding?.auth ?? { kind: "user" as const };

  if (requirement.kind === "public") {
    return { allowed: true };
  }

  if (requirement.kind === "system") {
    if (auth.kind === "system") {
      return { allowed: true };
    }
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: "command requires system auth context",
    };
  }

  if (auth.kind === "anonymous") {
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: "command requires authenticated user",
    };
  }

  if (auth.kind === "system") {
    return {
      allowed: false,
      code: FORGE_POLICY_DENIED,
      message: "command requires user auth context",
    };
  }

  if (requirement.kind === "user") {
    return { allowed: true };
  }

  const allowed = roleAllowed(matrix, requirement.policy, auth.role);
  if (allowed) {
    return { allowed: true, policy: requirement.policy, role: auth.role };
  }

  return {
    allowed: false,
    code: FORGE_POLICY_DENIED,
    message: `role '${auth.role}' denied for policy '${requirement.policy}'`,
    policy: requirement.policy,
    role: auth.role,
  };
}

export function simulatePolicy(
  matrix: PermissionMatrix,
  policy: string,
  role: string,
): PolicyEvaluationResult {
  const allowed = roleAllowed(matrix, policy, role);
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
