const POLICY_ROLE_PATTERN =
  /["']([^"']+)["']\s*:\s*canRole\s*\(\s*([^)]*)\)/g;

const COMMAND_AUTH_CAN_PATTERN = /auth\s*:\s*can\s*\(\s*["']([^"']+)["']\s*\)/;
const COMMAND_AUTH_PUBLIC_PATTERN = /auth\s*:\s*public_\s*\(\s*\)/;
const COMMAND_AUTH_SYSTEM_PATTERN = /auth\s*:\s*system\s*\(\s*\)/;

function parseRolesFromCanRoleArg(arg: string): string[] {
  const roles: string[] = [];
  for (const match of arg.matchAll(/["']([^"']+)["']/g)) {
    const role = match[1];
    if (role && !roles.includes(role)) {
      roles.push(role);
    }
  }
  return roles;
}

export function parsePoliciesFromSlice(sourceSlice: string): Array<{
  name: string;
  kind: "roles" | "public" | "system";
  roles: string[];
}> {
  const policies: Array<{
    name: string;
    kind: "roles" | "public" | "system";
    roles: string[];
  }> = [];

  for (const match of sourceSlice.matchAll(POLICY_ROLE_PATTERN)) {
    const name = match[1];
    const rolesArg = match[2] ?? "";
    if (!name) {
      continue;
    }
    policies.push({
      name,
      kind: "roles",
      roles: parseRolesFromCanRoleArg(rolesArg),
    });
  }

  return policies;
}

export function parseCommandAuthFromSlice(sourceSlice: string):
  | { kind: "policy"; policy: string }
  | { kind: "public" }
  | { kind: "system" }
  | { kind: "user" } {
  return parseAuthFromSlice(sourceSlice);
}

export function parseQueryAuthFromSlice(sourceSlice: string):
  | { kind: "policy"; policy: string }
  | { kind: "public" }
  | { kind: "system" }
  | { kind: "user" } {
  return parseAuthFromSlice(sourceSlice);
}

export function parseAuthFromSlice(sourceSlice: string):
  | { kind: "policy"; policy: string }
  | { kind: "public" }
  | { kind: "system" }
  | { kind: "user" } {
  const canMatch = sourceSlice.match(COMMAND_AUTH_CAN_PATTERN);
  if (canMatch?.[1]) {
    return { kind: "policy", policy: canMatch[1] };
  }

  if (COMMAND_AUTH_PUBLIC_PATTERN.test(sourceSlice)) {
    return { kind: "public" };
  }

  if (COMMAND_AUTH_SYSTEM_PATTERN.test(sourceSlice)) {
    return { kind: "system" };
  }

  return { kind: "public" };
}
