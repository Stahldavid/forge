import { AgentFabricError } from "./errors.ts";
import { ResourceLedger } from "./resource-ledger.ts";
import type {
  AuthorityResolution,
  DerivedGrantRequest,
  EffectClass,
  ExecutionGrant,
} from "./types.ts";

function isSubset<T>(child: readonly T[], parent: readonly T[]): boolean {
  const allowed = new Set(parent);
  return child.every((value) => allowed.has(value));
}

function reject(...reasonCodes: string[]): AuthorityResolution {
  return { outcome: "rejected", reasonCodes, limitations: [] };
}

export function grantAttenuationViolations(
  parent: ExecutionGrant,
  child: ExecutionGrant,
): readonly string[] {
  const violations: string[] = [];
  if (child.parentGrantId !== parent.grantId) violations.push("parent_grant_mismatch");
  if (child.rootAuthorizationId !== parent.rootAuthorizationId) {
    violations.push("root_authorization_changed");
  }
  if (!child.reservationId) violations.push("derived_grant_missing_reservation");
  if (!isSubset(child.capabilities, parent.capabilities)) violations.push("capability_scope_expanded");
  if (!isSubset(child.sourceIds, parent.sourceIds)) violations.push("source_scope_expanded");
  if (!isSubset(child.targetIds, parent.targetIds)) violations.push("target_scope_expanded");
  if (!isSubset<EffectClass>(child.effectClasses, parent.effectClasses)) {
    violations.push("effect_scope_expanded");
  }
  if (child.notBefore < parent.notBefore || child.expiresAt > parent.expiresAt) {
    violations.push("time_scope_expanded");
  }
  if (child.expiresAt <= child.notBefore) violations.push("invalid_time_window");
  if (child.maximumAttempts <= 0 || child.maximumAttempts > parent.maximumAttempts) {
    violations.push("attempt_limit_expanded");
  }
  if (
    child.delegationDepthRemaining < 0 ||
    child.delegationDepthRemaining >= parent.delegationDepthRemaining
  ) {
    violations.push("delegation_depth_not_attenuated");
  }
  for (const [resource, amount] of Object.entries(child.resourceCeilings)) {
    const ceiling = parent.resourceCeilings[resource];
    if (!Number.isFinite(amount) || amount <= 0 || ceiling === undefined || amount > ceiling) {
      violations.push(`resource_ceiling_expanded:${resource}`);
    }
  }
  return violations;
}

export function assertGrantAttenuated(
  parent: ExecutionGrant,
  child: ExecutionGrant,
): void {
  const violations = grantAttenuationViolations(parent, child);
  if (violations.length > 0) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Derived grant ${child.grantId} is not attenuated from ${parent.grantId}`,
      { violations },
    );
  }
}

export function deriveExecutionGrant(
  parent: ExecutionGrant,
  request: DerivedGrantRequest,
  ledger: ResourceLedger,
  now: number,
): AuthorityResolution {
  if (now < parent.notBefore || now >= parent.expiresAt) {
    return reject("parent_grant_not_current");
  }

  const aggregatedResourceRequests = Object.entries(
    request.resourceRequests.reduce<Record<string, number>>((totals, resourceRequest) => {
      totals[resourceRequest.resource] =
        (totals[resourceRequest.resource] ?? 0) + resourceRequest.amount;
      return totals;
    }, {}),
  ).map(([resource, amount]) => ({ resource, amount }));
  const candidate: ExecutionGrant = {
    grantId: request.grantId,
    rootAuthorizationId: parent.rootAuthorizationId,
    subjectId: request.subjectId,
    parentGrantId: parent.grantId,
    capabilities: [...request.capabilities],
    sourceIds: [...request.sourceIds],
    targetIds: [...request.targetIds],
    effectClasses: [...request.effectClasses],
    notBefore: request.notBefore,
    expiresAt: request.expiresAt,
    maximumAttempts: request.maximumAttempts,
    delegationDepthRemaining: request.delegationDepthRemaining,
    resourceCeilings: Object.fromEntries(
      aggregatedResourceRequests.map((item) => [item.resource, item.amount]),
    ),
    reservationId: request.reservationId,
  };
  const violations = grantAttenuationViolations(parent, candidate);
  if (violations.length > 0) return reject(...violations);

  let reservedRequests = request.resourceRequests;
  try {
    reservedRequests = ledger.reserve(
      request.reservationId,
      parent.grantId,
      aggregatedResourceRequests,
      parent.resourceCeilings,
    ).requests;
  } catch (error) {
    if (error instanceof AgentFabricError) {
      return reject(error.code.toLowerCase());
    }
    return { outcome: "unknown", reasonCodes: ["resource_reservation_unknown"], limitations: [] };
  }

  return {
    outcome: "allowed",
    reasonCodes: [],
    limitations: [],
    grant: {
      ...candidate,
      resourceCeilings: Object.fromEntries(
        reservedRequests.map((item) => [item.resource, item.amount]),
      ),
    },
  };
}

export function assertGrantCurrent(
  grant: ExecutionGrant,
  now: number,
  revokedReason?: string,
): void {
  if (revokedReason) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Grant ${grant.grantId} is revoked`,
      { revokedReason },
    );
  }
  if (now < grant.notBefore || now >= grant.expiresAt) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Grant ${grant.grantId} is outside its validity window`,
    );
  }
}
