import { describe, expect, test } from "bun:test";
import {
  AgentFabricError, DeterministicTestAdapter, ForgeAgentConductor, MemoryControlJournal, ResourceLedger,
  applyPlanDelta, computeRunPlanContentDigest, digestCanonical, executeP0aActivity, replayControlState, sha256Digest, stableStringify,
  type AgentFabricErrorCode, type AttemptExecutionPermit, type ControlEventEnvelope, type DerivedGrantRequest,
} from "../../src/forge/agent-fabric/index.ts";
import { VectorClock, childRequest, completeTrace, deriveChild, intent, makeHarness, permit,
  rechain, report, startup, vectorVerifier } from "./s11-fixtures.ts";

function errorCode(run: () => unknown, code: AgentFabricErrorCode) {
  let caught: unknown;
  try { run(); } catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(AgentFabricError);
  expect((caught as AgentFabricError).code).toBe(code);
}

describe("S1.1 conformance vectors", () => {
  const boundFields: (keyof AttemptExecutionPermit)[] = ["permitId", "intentId", "claimId", "attemptId", "workerId", "planRevisionId", "effectiveRunSpecDigest", "grantId", "fencingToken", "notBefore", "expiresAt"];
  for (const field of boundFields) {
    test(`S11-BINDING: changed permit ${field} cannot dispatch`, () => {
      const h = makeHarness(); const p = permit(h);
      h.conductor.authorizeAttemptDispatch(p);
      const changed = { ...p, [field]: typeof p[field] === "number" ? (p[field] as number) + 1 : field === "effectiveRunSpecDigest" ? sha256Digest("other") : "other" };
      errorCode(() => h.conductor.authorizeAttemptDispatch(changed), field === "intentId" || field === "grantId" ? "AF_GRANT_REJECTED" : "AF_PERMIT_REJECTED");
      expect(Object.keys(h.conductor.state().attempts)).toHaveLength(0);
    });
  }

  for (const now of [999, 1_000, 1_500, 2_000, 2_001]) {
    test(`S11-TIME: authorization admission at ${now}`, () => {
      const source = makeHarness();
      const authorization = { ...source.authorization, notBefore: 1_000, expiresAt: 2_000 };
      const conductor = new ForgeAgentConductor("run:s11", new MemoryControlJournal(), new VectorClock(now), sha256Digest, vectorVerifier);
      if (now >= 1_000 && now < 2_000) {
        conductor.registerOwnerAuthorization(authorization);
        expect(conductor.events()[0]!.occurredAt).toBe(now);
        expect(conductor.state().authorizations[authorization.authorizationId]).toEqual(authorization);
      } else errorCode(() => conductor.registerOwnerAuthorization(authorization), "AF_GRANT_REJECTED");
    });
  }

  for (const now of [1_099, 1_100, 1_150, 1_200, 1_201]) {
    test(`S11-TIME: future root grant can register but permit requires currentness at ${now}`, () => {
      const h = makeHarness();
      const grant = { ...h.root, grantId: "future", notBefore: 1_100, expiresAt: 1_200, maximumAttempts: 1, resourceCeilings: {} };
      h.conductor.registerGrant(grant);
      const i = intent(h);
      const c = h.conductor.claimDispatch({ claimId: "c", intentId: i.intentId, workerId: grant.subjectId, attemptId: "a", leaseDurationMs: 1_000 });
      h.clock.time = now;
      const issue = () => h.conductor.issuePermit({ permitId: "p", claimId: c.claimId, grantId: grant.grantId, maximumValidityMs: 500 });
      if (now >= 1_100 && now < 1_200) { const p = issue(); expect(p.notBefore).toBe(now); expect(p.expiresAt).toBe(1_200); }
      else errorCode(issue, "AF_GRANT_REJECTED");
    });
  }

  for (const timestamp of [999, 1_000, 1_050, 1_100, 1_101]) {
    test(`S11-TIME: startup/report evidence timestamp ${timestamp} against now 1100`, () => {
      const h = makeHarness(); const p = permit(h); h.clock.time = 1_100;
      const accepted = timestamp >= 1_000 && timestamp <= 1_100;
      if (accepted) { startup(h, p, timestamp); expect(h.conductor.state().attempts[p.attemptId]!.startedAt).toBe(timestamp); }
      else errorCode(() => startup(h, p, timestamp), "AF_PERMIT_REJECTED");
      const other = makeHarness(); const op = permit(other); startup(other, op); other.clock.time = 1_100;
      const r = { ...report(other, op), reportedAt: timestamp };
      if (accepted) expect(other.conductor.commitOutcome(r).reportedAt).toBe(timestamp);
      else errorCode(() => other.conductor.commitOutcome(r), "AF_INVALID_STATE");
    });
  }

  test("S11-REJECTIONS: typed entry guards and journal conflict categories", () => {
    const h = makeHarness();
    errorCode(() => h.conductor.revokeOwnerAuthorization("missing", "reason"), "AF_NOT_FOUND");
    errorCode(() => h.conductor.revokeGrant("missing", "reason"), "AF_NOT_FOUND");
    errorCode(() => h.conductor.consumeResourceReservation("missing"), "AF_NOT_FOUND");
    errorCode(() => h.conductor.releaseResourceReservation("missing"), "AF_NOT_FOUND");
    errorCode(() => h.conductor.registerGrant({ ...h.root, grantId: "over", maximumAttempts: 51 }), "AF_RESOURCE_EXHAUSTED");
    const i = intent(h);
    errorCode(() => h.conductor.commitDispatchIntent({ ...i, intentId: "future", createdAt: 1_001 }), "AF_INVALID_STATE");
    const c = h.conductor.claimDispatch({ claimId: "c", intentId: i.intentId, workerId: h.root.subjectId, attemptId: "a", leaseDurationMs: 500 });
    errorCode(() => h.conductor.claimDispatch({ ...c, leaseDurationMs: 500 }), "AF_DUPLICATE_ID");
    errorCode(() => h.conductor.issuePermit({ permitId: "p", claimId: c.claimId, grantId: h.root.grantId, maximumValidityMs: 0 }), "AF_PERMIT_REJECTED");
    const original = h.journal.readAll()[0]!;
    const { sequence: _, predecessorEventId: __, predecessorEventDigest: ___, eventDigest: ____, ...input } = original;
    const noKey = { ...input }; delete noKey.idempotencyKey;
    const journal = new MemoryControlJournal(); journal.append({ expectedSequence: 0, event: noKey });
    errorCode(() => journal.append({ expectedSequence: 1, event: { ...noKey, rootExecutionId: "different" } }), "AF_DUPLICATE_ID");
    errorCode(() => journal.append({ expectedSequence: 0, event: { ...noKey, eventId: "new" } }), "AF_CONFLICT");
  });

  test("S11-SEMANTIC: each event family rejects a structurally valid single fault", () => {
    const h = completeTrace();
    for (let index = 0; index < h.conductor.events().length; index++) {
      const events = structuredClone(h.conductor.events().slice(0, index + 1));
      const payload = events[index]!.payload;
      switch (payload.type) {
        case "owner_authorization_registered": payload.verification.authorizationDigest = sha256Digest("wrong"); break;
        case "owner_authorization_revoked": payload.authorizationId = "missing"; break;
        case "resource_ledger_initialized": payload.definitions = payload.definitions.map((d) => ({ ...d, limit: d.limit + 1 })); break;
        case "resource_reservation_consumed": case "resource_reservation_released": payload.reservationId = "missing"; break;
        case "goal_registered": payload.goal.authorityInvocationId = "missing"; break;
        case "grant_registered": payload.grant.parentGrantId = "missing"; break;
        case "grant_revoked": payload.grantId = "missing"; break;
        case "plan_delta_registered": payload.delta.baseRevisionId = "missing"; break;
        case "plan_revision_activated": payload.revision.contentDigest = sha256Digest("wrong"); break;
        case "dispatch_intent_committed": payload.intent.taskNodeId = "missing"; break;
        case "scheduling_claim_committed": payload.claim.fencingToken += 1; break;
        case "attempt_execution_permit_issued": payload.permit.effectiveRunSpecDigest = sha256Digest("wrong"); break;
        case "attempt_started": payload.permitId = "missing"; break;
        case "attempt_uncertainty_observed": payload.observation.observedAt += 1; break;
        case "attempt_outcome_committed": payload.outcome.reportDigest = sha256Digest("wrong"); break;
      }
      errorCode(() => replayControlState(rechain(events), h.trust), "AF_INVALID_EVENT");
    }
  });

  test("S11-TRACE: all event classes have valid prefixes and reject a foreign root", () => {
    const h = completeTrace();
    const events = h.journal.readAll();
    expect(new Set(events.map((e) => e.payload.type)).size).toBe(16);
    expect(replayControlState(events, h.trust)).toEqual(h.conductor.state());
    for (let i = 0; i < events.length; i++) {
      expect(replayControlState(events.slice(0, i + 1), h.trust).lastSequence).toBe(i + 1);
      const invalid = structuredClone(events.slice(0, i + 1)) as ControlEventEnvelope[];
      invalid[i]!.rootExecutionId = "run:foreign";
      errorCode(() => replayControlState(rechain(invalid), h.trust), "AF_INVALID_EVENT");
    }
  });

  const attenuation: [string, Partial<DerivedGrantRequest>, string][] = [
    ["capability", { capabilities: ["write"] }, "capability_scope_expanded"],
    ["source", { sourceIds: ["source:other"] }, "source_scope_expanded"],
    ["target", { targetIds: ["target:other"] }, "target_scope_expanded"],
    ["effect", { effectClasses: ["consequential"] }, "effect_scope_expanded"],
    ["notBefore", { notBefore: -1 }, "time_scope_expanded"],
    ["expiresAt", { expiresAt: 10_001 }, "time_scope_expanded"],
    ["empty window", { notBefore: 1_000, expiresAt: 1_000 }, "invalid_time_window"],
    ["attempt", { maximumAttempts: 51 }, "attempt_budget_exhausted"],
    ["depth", { delegationDepthRemaining: 3 }, "delegation_depth_not_attenuated"],
    ["resource", { resourceRequests: [{ resource: "calls", amount: 51 }] }, "resource_ceiling_expanded:calls"],
  ];
  for (const [dimension, change, reason] of attenuation) {
    test(`S11-ATTENUATION: ${dimension}`, () => {
      const h = makeHarness();
      const rejected = h.conductor.deriveAndRegisterGrant(h.root.grantId, { ...childRequest(h), ...change });
      expect(rejected.outcome).toBe("rejected");
      expect(rejected.reasonCodes).toContain(reason);
      expect(h.conductor.state().grants["grant:child"]).toBeUndefined();
      expect(deriveChild(h).parentGrantId).toBe(h.root.grantId);
    });
  }

  for (const ancestor of ["authorization", "root", "intermediate"] as const) {
    for (const boundary of ["permit", "startup", "outcome"] as const) {
      test(`S11-EXPIRY: ${ancestor} at ${boundary}`, () => {
        const h = makeHarness({ authorizationEnd: ancestor === "authorization" ? 2_000 : 10_000,
          grantEnd: ancestor === "root" ? 2_000 : undefined });
        const request = childRequest(h);
        if (ancestor === "intermediate") request.expiresAt = 2_000;
        const resolution = h.conductor.deriveAndRegisterGrant(h.root.grantId, request);
        expect(resolution.outcome).toBe("allowed");
        const child = resolution.grant!;
        const grandRequest = childRequest(h, "grandchild", child);
        grandRequest.maximumAttempts = 1;
        const grand = h.conductor.deriveAndRegisterGrant(child.grantId, grandRequest).grant!;
        const value = intent(h);
        const claim = h.conductor.claimDispatch({ claimId: "claim:expiry", intentId: value.intentId,
          attemptId: "attempt:expiry", workerId: grand.subjectId, leaseDurationMs: 5_000 });
        const issue = () => h.conductor.issuePermit({ permitId: "permit:expiry", claimId: claim.claimId,
          grantId: grand.grantId, maximumValidityMs: 5_000 });
        if (boundary === "permit") {
          h.clock.time = 2_000;
          errorCode(issue, "AF_GRANT_REJECTED");
        } else {
          const p = issue();
          expect(p.expiresAt).toBe(2_000);
          if (boundary === "outcome") startup(h, p);
          h.clock.time = 2_000;
          errorCode(() => boundary === "startup" ? startup(h, p) : h.conductor.commitOutcome(report(h, p)),
            boundary === "startup" ? "AF_PERMIT_REJECTED" : "AF_STALE_ATTEMPT");
        }
      });
    }
  }

  test("S11-CLAIM: revoked authorization permits scheduling but never execution", () => {
    const h = makeHarness(); const value = intent(h);
    h.conductor.revokeOwnerAuthorization(h.authorization.authorizationId, "revoked");
    const claim = h.conductor.claimDispatch({ claimId: "claim:revoked", intentId: value.intentId,
      attemptId: "attempt:revoked", workerId: h.root.subjectId, leaseDurationMs: 100 });
    expect(h.conductor.state().claims[claim.claimId]).toEqual(claim);
    errorCode(() => h.conductor.issuePermit({ permitId: "permit:revoked", claimId: claim.claimId,
      grantId: h.root.grantId, maximumValidityMs: 50 }), "AF_GRANT_REJECTED");
  });

  test("S11-OFFER: offer has no event or authority; forged permit cannot dispatch", () => {
    const h = makeHarness(); const value = intent(h);
    const before = h.journal.readAll().length;
    const offer = h.conductor.createDispatchOffer(value.intentId, "pool", "offer:s11", 1_100);
    expect(offer.nonAuthoritative).toBe(true); expect(h.journal.readAll().length).toBe(before);
    errorCode(() => h.conductor.createDispatchOffer(value.intentId, "pool", "expired", 1_000), "AF_INVALID_STATE");
    const p = permit(h, "real");
    errorCode(() => h.conductor.authorizeAttemptDispatch({ ...p, permitId: offer.offerId }), "AF_PERMIT_REJECTED");
    expect(Object.keys(h.conductor.state().attempts)).toHaveLength(0);
    expect(() => h.conductor.authorizeAttemptDispatch(p)).not.toThrow();
  });

  for (const at of [1_099, 1_100, 1_101]) {
    test(`S11-LEASE: permit and outcome at ${at}`, () => {
      const h = makeHarness(); const value = intent(h);
      const claim = h.conductor.claimDispatch({ claimId: "claim:lease", intentId: value.intentId,
        attemptId: "attempt:lease", workerId: h.root.subjectId, leaseDurationMs: 100 });
      h.clock.time = at;
      const issue = () => h.conductor.issuePermit({ permitId: "permit:lease", claimId: claim.claimId,
        grantId: h.root.grantId, maximumValidityMs: 500 });
      if (at >= 1_100) errorCode(issue, "AF_STALE_ATTEMPT");
      else expect(issue().expiresAt).toBe(1_100);
      const h2 = makeHarness(); const p = permit(h2, "outcome", h2.root, 100, 500);
      startup(h2, p); h2.clock.time = at;
      if (at >= 1_100) errorCode(() => h2.conductor.commitOutcome(report(h2, p)), "AF_STALE_ATTEMPT");
      else expect(h2.conductor.commitOutcome(report(h2, p)).status).toBe("succeeded");
    });
  }

  test("S11-FENCE: generation N loses authority after N+1 claims", () => {
    const h = makeHarness(); const old = permit(h, "fence", h.root, 100, 100); startup(h, old);
    h.clock.time = 1_100;
    const claim = h.conductor.claimDispatch({ claimId: "claim:new", intentId: old.intentId,
      attemptId: "attempt:new", workerId: h.root.subjectId, leaseDurationMs: 100 });
    expect(claim.fencingToken).toBe(old.fencingToken + 1);
    const current = h.conductor.issuePermit({ permitId: "permit:new", claimId: claim.claimId,
      grantId: h.root.grantId, maximumValidityMs: 100 });
    errorCode(() => startup(h, old), "AF_PERMIT_REJECTED");
    errorCode(() => h.conductor.commitOutcome(report(h, old)), "AF_STALE_ATTEMPT");
    startup(h, current); expect(h.conductor.commitOutcome(report(h, current)).fencingToken).toBe(claim.fencingToken);
  });

  test("S11-PLAN: program and execution substitutions fail without activation", () => {
    const h = makeHarness();
    const delta = { deltaId: "delta:test", rootExecutionId: "run:s11", baseRevisionId: h.revision.revisionId,
      nextRevisionId: "plan:next", operations: [] };
    h.conductor.registerPlanDelta(delta);
    const next = applyPlanDelta(h.revision, delta, sha256Digest);
    errorCode(() => h.conductor.activatePlan({ ...next, rootExecutionId: "other" }, h.revision.revisionId), "AF_INVALID_PLAN");
    errorCode(() => h.conductor.activatePlan({ ...next, programVersionId: "other@1",
      contentDigest: computeRunPlanContentDigest("other@1", next.nodes, sha256Digest) }, h.revision.revisionId), "AF_INVALID_PLAN");
    h.conductor.activatePlan(next, h.revision.revisionId);
    expect(h.conductor.state().activePlanRevisionByExecution["run:s11"]).toBe(next.revisionId);
    errorCode(() => h.conductor.activatePlan(next, h.revision.revisionId), "AF_CONFLICT");
  });

  for (const semantics of ["consumable", "capacity", "counter"] as const) {
    for (const transition of ["reserve", "consume", "release", "consume-release"] as const) {
      test(`S11-RESTART: ${semantics} ${transition}`, () => {
        const h = makeHarness({ definitions: [{ resource: "units", semantics, limit: 3 }] });
        const child = deriveChild(h);
        if (transition.includes("consume")) h.conductor.consumeResourceReservation(child.reservationId!);
        if (transition.includes("release")) h.conductor.releaseResourceReservation(child.reservationId!);
        const prior = h.conductor.state();
        const journal = new MemoryControlJournal();
        for (const event of h.journal.readAll()) {
          const { sequence, predecessorEventId: _, predecessorEventDigest: __, eventDigest: ___, ...input } = event;
          journal.append({ expectedSequence: sequence - 1, event: input });
        }
        const resumed = new ForgeAgentConductor("run:s11", journal, h.clock, sha256Digest,
          vectorVerifier, new ResourceLedger(h.definitions));
        expect(resumed.state()).toEqual(prior);
        // A full-limit request distinguishes restored usage from an incorrectly empty ledger.
        const request = { ...childRequest(h, "next"), resourceRequests: [{ resource: "units", amount: 3 }] };
        const decision = resumed.deriveAndRegisterGrant(h.root.grantId, request);
        expect(decision).toEqual(h.conductor.deriveAndRegisterGrant(h.root.grantId, request));
        const recoveredAll = semantics === "capacity" && transition.includes("release") ||
          semantics === "consumable" && transition === "release";
        expect(decision.outcome).toBe(recoveredAll ? "allowed" : "rejected");
        if (!recoveredAll) expect(decision.reasonCodes).toEqual(["af_resource_exhausted"]);
        expect(resumed.state()).toEqual(h.conductor.state());
        const tooLarge = { ...childRequest(h, "over"), resourceRequests: [{ resource: "units", amount: 4 }] };
        expect(resumed.deriveAndRegisterGrant(h.root.grantId, tooLarge).outcome).toBe("rejected");
        if (transition === "release") errorCode(() => resumed.consumeResourceReservation(child.reservationId!), "AF_INVALID_EVENT");
      });
    }
  }

  const chainMutations: [string, (events: ControlEventEnvelope[]) => void][] = [
    ["sequence", (e) => { e[1]!.sequence++; }],
    ["reorder", (e) => { [e[0], e[1]] = [e[1]!, e[0]!]; }],
    ["predecessor id", (e) => { e[1]!.predecessorEventId = "other"; }],
    ["predecessor digest", (e) => { e[1]!.predecessorEventDigest = sha256Digest("other"); }],
    ["event digest", (e) => { e[1]!.eventDigest = sha256Digest("other"); }],
    ["time", (e) => { e[1]!.occurredAt = 0; }],
  ];
  for (const [name, mutate] of chainMutations) {
    test(`S11-CHAIN: ${name}`, () => {
      const h = makeHarness(); const events = structuredClone(h.journal.readAll()) as ControlEventEnvelope[];
      mutate(events); errorCode(() => replayControlState(events, h.trust), "AF_INVALID_EVENT");
    });
  }

  test("S11-IDEMPOTENCY: API retry differs from duplicated persisted events", () => {
    const h = makeHarness(); const first = h.journal.readAll()[0]!;
    const { sequence, predecessorEventId: _, predecessorEventDigest: __, eventDigest: ___, ...event } = first;
    const before = h.journal.readAll().length;
    expect(h.journal.append({ expectedSequence: 0, event: { ...event, occurredAt: 1_001 } })).toEqual(first);
    expect(h.journal.readAll()).toHaveLength(before);
    errorCode(() => h.journal.append({ expectedSequence: before, event: { ...event, eventId: "other" } }), "AF_CONFLICT");
    errorCode(() => replayControlState(rechain([first, first]), h.trust), "AF_INVALID_EVENT");
    const p = permit(h); startup(h, p); const r = report(h, p);
    const committed = h.conductor.commitOutcome(r); h.clock.time = 20_000;
    expect(h.conductor.commitOutcome(r)).toEqual(committed);
    errorCode(() => h.conductor.commitOutcome({ ...r, resultDigest: sha256Digest("other") }), "AF_CONFLICT");
  });

  test("S11-CANON: fixed bytes/digest and rejection without getter execution", () => {
    const value = JSON.parse('{"z":-0,"a":[1,true,null],"__proto__":2}');
    const bytes = '{"__proto__":2,"a":[1,true,null],"z":0}';
    expect(stableStringify(value)).toBe(bytes);
    expect(sha256Digest("abc")).toBe("sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(digestCanonical(value, sha256Digest)).toBe(sha256Digest(bytes));
    let reads = 0;
    const getter = Object.defineProperty({}, "x", { enumerable: true, get() { reads++; return 1; } });
    const hidden = Object.defineProperty({}, "x", { value: 1 });
    for (const invalid of [getter, hidden, { [Symbol("x")]: 1 }, Object.create({ x: 1 }), Infinity, NaN,
      undefined, 1n, () => 1, new Date(), new Map()]) errorCode(() => stableStringify(invalid), "AF_CANONICALIZATION_FAILED");
    expect(reads).toBe(0);
    const cycle: unknown[] = []; cycle.push(cycle);
    errorCode(() => stableStringify(cycle), "AF_CANONICALIZATION_FAILED");
    const shared = { x: 1 }; expect(stableStringify([shared, shared])).toBe('[{"x":1},{"x":1}]');
  });

  test("S11-ERROR: replay preserves canonicalization errors and wraps unexpected exceptions", () => {
    const h = makeHarness(); const events = structuredClone(h.journal.readAll());
    Object.defineProperty(events[0]!.payload, "hidden", { value: 1 });
    errorCode(() => replayControlState(events, h.trust), "AF_CANONICALIZATION_FAILED");
    errorCode(() => replayControlState([{ ...events[0]!, payload: null as never }], h.trust), "AF_INVALID_EVENT");
  });

  test("S11-UNCERTAINTY: adapter failure is non-terminal and retry requires new claim", async () => {
    const h = makeHarness(); const p = permit(h);
    const adapter = new DeterministicTestAdapter([], () => h.clock.now());
    adapter.startAttempt = async () => { throw new Error("synthetic unavailable"); };
    adapter.collectOutcome = async () => { throw new Error("unreachable"); };
    const result = await executeP0aActivity({ conductor: h.conductor, permit: p, adapter });
    expect(result.status).toBe("unknown"); expect(Object.keys(h.conductor.state().outcomes)).toHaveLength(0);
    expect(Object.keys(h.conductor.state().uncertaintyObservations)).toHaveLength(1);
    errorCode(() => h.conductor.recordAttemptUncertainty(p, "outcome", "no startup"), "AF_INVALID_STATE");
    h.clock.time = 1_500;
    expect(h.conductor.claimDispatch({ claimId: "retry", intentId: p.intentId, attemptId: "retry",
      workerId: h.root.subjectId, leaseDurationMs: 100 }).fencingToken).toBe(2);
  });
});
