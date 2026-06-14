export function canRole(...roles) {
  return { type: "role", roles };
}

export function can(policy) {
  return { type: "policy", policy };
}

export function public_() {
  return { type: "public" };
}

export function system() {
  return { type: "system" };
}

export function definePolicies(policies) {
  return policies;
}
