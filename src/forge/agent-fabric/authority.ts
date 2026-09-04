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

export function deriveExecutionGrant(
  parent: ExecutionGrant,
  request: DerivedGrantRequest,
  ledger: ResourceLedger,
  now: number,
): AuthorityResolution {
  if (now < parent.notBefore || now >= parent.expiresAt) {
    return reject("parent_grant_not_current");
  }
  if (parent.delegationDepthRemaining <= 0) {
    return reject("delegation_depth_exhausted");
  }
  if (!isSubset(request.capabilities, parent.capabilities)) {
    return reject("capability_scope_expanded");
  }
  if (!isSubset(request.sourceIds, parent.sourceIds)) {
    return reject("source_scope_expanded");
  }
  if (!isSubset(request.targetIds, parent.targetIds)) {
    return reject("target_scope_expanded");
  }
  if (!isSubset<EffectClass>(request.effectClasses, parent.effectClasses)) {
    return reject("effect_scope_expanded");
  }
  if (request.notBefore < parent.notBefore || request.expiresAt > parent.expiresAt) {
    return reject("time_scope_expanded");
  }
  if (request.expiresAt <= request.notBefore) {
    return reject("invalid_time_window");
  }
  if (request.maximumAttempts > parent.maximumAttempts || request.maximumAttempts <= 0) {
    return reject("attempt_limit_expanded");
  }
  if (
    request.delegationDepthRemaining < 0 ||
    request.delegationDepthRemaining >= parent.delegationDepthRemaining
  ) {
    return reject("delegation_depth_not_attenuated");
  }

  for (const resourceRequest of request.resourceRequests) {
    const ceiling = parent.resourceCeilings[resourceRequest.resource];
    if (ceiling === undefined || resourceRequest.amount > ceiling) {
      return reject("resource_ceiling_expanded");
    }
  }

  let reservedRequests = request.resourceRequests;
  try {
    reservedRequests = ledger.reserve(
      request.reservationId,
      request.grantId,
      request.resourceRequests,
    ).requests;
  } catch (error) {
    if (error instanceof AgentFabricError) {
      return reject(error.code.toLowerCase());
    }
    return { outcome: "unknown", reasonCodes: ["resource_reservation_unknown"], limitations: [] };
  }

  const resourceCeilings = Object.fromEntries(
    reservedRequests.map((item) => [item.resource, item.amount]),
  );
  return {
    outcome: "allowed",
    reasonCodes: [],
    limitations: [],
    grant: {
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
      resourceCeilings,
      reservationId: request.reservationId,
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
