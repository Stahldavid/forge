import { AgentFabricError } from "./errors.ts";
import { ResourceLedger } from "./resource-ledger.ts";
import type {
  AuthorityResolution,
  ControlState,
  DerivedGrantRequest,
  EffectClass,
  ExecutionGrant,
  OwnerAuthorization,
} from "./types.ts";

function isSubset<T>(child: readonly T[], parent: readonly T[]): boolean {
  const allowed = new Set(parent);
  return child.every((value) => allowed.has(value));
}

function reject(...reasonCodes: string[]): AuthorityResolution {
  return { outcome: "rejected", reasonCodes, limitations: [] };
}

export function rootGrantAuthorizationViolations(
  authorization: OwnerAuthorization,
  grant: ExecutionGrant,
): readonly string[] {
  const violations: string[] = [];
  if (grant.parentGrantId !== null) violations.push("root_grant_has_parent");
  if (grant.rootAuthorizationId !== authorization.authorizationId) {
    violations.push("root_authorization_mismatch");
  }
  if (authorization.rootExecutionId.length === 0) violations.push("authorization_missing_execution");
  if (!authorization.subjectIds.includes(grant.subjectId)) violations.push("subject_not_authorized");
  if (!isSubset(grant.capabilities, authorization.capabilities)) violations.push("capability_scope_expanded");
  if (!isSubset(grant.sourceIds, authorization.sourceIds)) violations.push("source_scope_expanded");
  if (!isSubset(grant.targetIds, authorization.targetIds)) violations.push("target_scope_expanded");
  if (!isSubset<EffectClass>(grant.effectClasses, authorization.effectClasses)) {
    violations.push("effect_scope_expanded");
  }
  if (grant.notBefore < authorization.notBefore || grant.expiresAt > authorization.expiresAt) {
    violations.push("time_scope_expanded");
  }
  if (grant.expiresAt <= grant.notBefore) violations.push("invalid_time_window");
  if (grant.maximumAttempts <= 0 || grant.maximumAttempts > authorization.maximumAttempts) {
    violations.push("attempt_limit_expanded");
  }
  if (
    grant.delegationDepthRemaining < 0 ||
    grant.delegationDepthRemaining > authorization.maximumDelegationDepth
  ) {
    violations.push("delegation_depth_expanded");
  }
  for (const [resource, amount] of Object.entries(grant.resourceCeilings)) {
    const ceiling = authorization.resourceCeilings[resource];
    if (!Number.isFinite(amount) || amount <= 0 || ceiling === undefined || amount > ceiling) {
      violations.push(`resource_ceiling_expanded:${resource}`);
    }
  }
  return violations;
}

export function assertRootGrantAuthorized(
  authorization: OwnerAuthorization,
  grant: ExecutionGrant,
): void {
  const violations = rootGrantAuthorizationViolations(authorization, grant);
  if (violations.length > 0) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Root grant ${grant.grantId} exceeds authorization ${authorization.authorizationId}`,
      { violations },
    );
  }
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

  try {
    const reserved = ledger.reserve(
      request.reservationId,
      parent.grantId,
      aggregatedResourceRequests,
      parent.resourceCeilings,
    );
    return {
      outcome: "allowed",
      reasonCodes: [],
      limitations: [],
      grant: {
        ...candidate,
        resourceCeilings: Object.fromEntries(
          reserved.requests.map((item) => [item.resource, item.amount]),
        ),
      },
    };
  } catch (error) {
    if (error instanceof AgentFabricError) {
      return reject(error.code.toLowerCase());
    }
    return { outcome: "unknown", reasonCodes: ["resource_reservation_unknown"], limitations: [] };
  }
}

export function assertAuthorizationCurrent(
  authorization: OwnerAuthorization,
  now: number,
  revokedReason?: string,
): void {
  if (revokedReason) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Owner authorization ${authorization.authorizationId} is revoked`,
      { revokedReason },
    );
  }
  if (now < authorization.notBefore || now >= authorization.expiresAt) {
    throw new AgentFabricError(
      "AF_GRANT_REJECTED",
      `Owner authorization ${authorization.authorizationId} is outside its validity window`,
    );
  }
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

export function assertGrantLineageCurrent(
  state: Pick<
    ControlState,
    "authorizations" | "revokedAuthorizations" | "grants" | "revokedGrants"
  >,
  grantId: string,
  now: number,
): void {
  const seen = new Set<string>();
  let current = state.grants[grantId];
  if (!current) throw new AgentFabricError("AF_NOT_FOUND", `Unknown grant: ${grantId}`);

  while (true) {
    if (seen.has(current.grantId)) {
      throw new AgentFabricError("AF_GRANT_REJECTED", "Grant ancestry contains a cycle");
    }
    seen.add(current.grantId);
    assertGrantCurrent(current, now, state.revokedGrants[current.grantId]);

    if (!current.parentGrantId) {
      const authorization = state.authorizations[current.rootAuthorizationId];
      if (!authorization) {
        throw new AgentFabricError(
          "AF_GRANT_REJECTED",
          `Root grant ${current.grantId} has no registered owner authorization`,
        );
      }
      assertAuthorizationCurrent(
        authorization,
        now,
        state.revokedAuthorizations[authorization.authorizationId],
      );
      assertRootGrantAuthorized(authorization, current);
      return;
    }

    const parent = state.grants[current.parentGrantId];
    if (!parent) {
      throw new AgentFabricError(
        "AF_GRANT_REJECTED",
        `Grant ${current.grantId} references missing parent ${current.parentGrantId}`,
      );
    }
    assertGrantAttenuated(parent, current);
    current = parent;
  }
}
