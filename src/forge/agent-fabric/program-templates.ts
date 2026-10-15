import { programAssert, programDigest, programWithin, refKey, registryEntry, validateProgramData, type ProgramRef, type ProgramRegistry, type WorkflowProgramV2 } from "./program-contract.ts";
import { validateProgramCapabilities } from "./program-worker.ts";

export type ProgramTemplateKind = "review" | "bugfix" | "migration";
export interface ProgramTemplateOptions {
  id?: string;
  inputSchema: ProgramRef; outputSchema: ProgramRef; policy: ProgramRef; acceptance: ProgramRef;
  implement: ProgramRef; review: ProgramRef; population?: ProgramRef;
  resolver?: ProgramRef; resolverWriteScope?: string[];
  evidence?: ProgramRef[];
  approvalSchema?: ProgramRef;
}
const expr = ($expr: string, ...args: unknown[]) => ({ $expr, args });

/** Owner references only. This constructs finite data; it never dispatches workers. */
export function buildWorkflowTemplate(kind: ProgramTemplateKind, options: ProgramTemplateOptions, registry: ProgramRegistry): WorkflowProgramV2 {
  programAssert(["review", "bugfix", "migration"].includes(kind), "Unknown workflow template");
  programAssert(options.id === undefined || typeof options.id === "string" && options.id.length > 0 && options.id.length <= 200, "Template identity exceeds supported event correlation bounds");
  const acceptance = registryEntry(registry.acceptance, options.acceptance);
  const policy = registryEntry(registry.policies, options.policy);
  const reviewer = registryEntry(registry.executors, options.review);
  const implementer = registryEntry(registry.executors, options.implement);
  const writeScope = [...new Set([...acceptance.writeScope, ...policy.writeScope, ...implementer.writeScope])].filter(path => [acceptance.writeScope, policy.writeScope, implementer.writeScope].every(scope => programWithin(path, scope)));
  programAssert(kind === "review" || implementer.effect === "isolated-write" && implementer.role === "implementer" && writeScope.length > 0, "Writing templates require an authorized implementer scope");
  validateProgramCapabilities(reviewer, policy, acceptance, []);
  if (kind !== "review") validateProgramCapabilities(implementer, policy, acceptance, writeScope);
  const captureRequired = (acceptance.obligations ?? []).some(obligation => obligation.requiredEvidence?.includes("capture"));
  programAssert((acceptance.obligations ?? []).every(obligation => (obligation.requiredEvidence ?? []).every(evidence => evidence === "capture")), "Template cannot attest unsupported evidence obligations");
  programAssert(!captureRequired || kind === "migration" && options.population && options.evidence?.length, "Capture obligations require a population migration and evidence executors");
  for (const ref of options.evidence ?? []) {
    const executor = registryEntry(registry.executors, ref);
    programAssert(executor.effect === "read", "Template evidence must be readonly");
    validateProgramCapabilities(executor, policy, acceptance, []);
  }
  if (acceptance.requireHumanApproval) {
    programAssert(options.approvalSchema, "Human approval requires an owner-registered approval schema");
    const schema = registryEntry(registry.schemas, options.approvalSchema);
    programAssert(!schema.type || (Array.isArray(schema.type) ? schema.type : [schema.type]).includes("object"), "Approval schema must allow object payloads");
    if (schema.properties?.approved) validateProgramData(true, schema.properties.approved);
    if (schema.const) programAssert(typeof schema.const === "object" && !Array.isArray(schema.const) && schema.const.approved === true, "Approval constant must authorize approval");
  }
  let resolverWriteScope: string[] | undefined;
  if (options.resolver) {
    const resolver = registryEntry(registry.executors, options.resolver);
    programAssert(kind === "migration" && resolver.role === "implementer" && resolver.effect === "isolated-write" && policy.executors.includes(refKey(options.resolver)), "Migration resolver must be an owner-authorized implementer");
    const intersection = [...new Set([...acceptance.writeScope, ...policy.writeScope, ...resolver.writeScope])].filter(path => [acceptance.writeScope, policy.writeScope, resolver.writeScope].every(scope => programWithin(path, scope)));
    resolverWriteScope = validateProgramCapabilities(resolver, policy, acceptance, options.resolverWriteScope ?? intersection);
  }
  programAssert(!options.resolverWriteScope || options.resolver, "Resolver scope requires a resolver");
  programAssert(reviewer.role === "reviewer" && reviewer.effect === "read", "Template requires a readonly reviewer");
  programAssert(programDigest(reviewer) !== programDigest(implementer), "Template requires a distinct reviewer");
  for (const ref of [options.implement, options.review]) programAssert(policy.executors.includes(refKey(ref)), "Template executor not authorized by owner policy");
  for (const key of new Set([...acceptance.requiredChecks, ...(acceptance.requiredChecksByScope?.item ?? []), ...(acceptance.requiredChecksByScope?.final ?? [])])) {
    const checker = registry.executors[key];
    programAssert(checker?.kind === "command" && checker.effect === "read" && policy.executors.includes(key), `Required check not an authorized readonly command: ${key}`);
    programAssert(programDigest(checker) !== programDigest(reviewer), "Required check must be distinct from reviewer");
    validateProgramCapabilities(checker, policy, acceptance, []);
  }
  const scoped = acceptance.requiredChecksByScope;
  const repair = (id: string, initialCandidate: unknown, phase: "item" | "final", entryMode: "assess-first" | "implement-first", scope: unknown) => ({
    kind: "repair", id, options: {
      recipe: { id: "repair", version: "v2" }, implement: options.implement, review: options.review,
      checks: scoped?.[phase] ?? acceptance.requiredChecks,
      ...(options.evidence?.length ? { evidence: options.evidence } : {}),
      ...(scoped ? { assessmentScope: phase } : {}), entryMode, initialCandidate, writeScope: scope,
      maxRepairRounds: kind === "review" ? 1 : 3, maxAssessmentAttempts: 6, maxInfrastructureAttempts: 2,
      progressPolicy: { unchangedCandidateRounds: 1, repeatedFindingsRounds: 2 },
    },
  });
  const program: WorkflowProgramV2 = {
    schemaVersion: 2, operatorVersion: 2, mode: "candidate", id: options.id ?? `${kind}-workflow`, version: 1,
    inputSchema: options.inputSchema, outputSchema: options.outputSchema, policy: options.policy, acceptance: options.acceptance,
    steps: [], result: expr("output", "final"),
  };
  if (kind === "migration") {
    programAssert(options.population, "Migration requires an owner population");
    registryEntry(registry.populations, options.population);
    program.population = options.population;
    const items = expr("field", expr("workflowInput"), "items");
    program.steps.push({ kind: "map", id: "migrate", options: {
      items, key: expr("field", expr("item"), "id"),
      coverage: expr("coverageFor", expr("population"), items), completion: "all-required", concurrency: policy.concurrency,
      body: repair("component", expr("candidateFromBaseline", expr("item")), "item", "assess-first", expr("field", expr("item"), "allowedPaths")),
    } }, { kind: "compose", id: "integrate", options: { candidates: expr("acceptedCandidates", "migrate"), onConflict: "needs-resolution", ...(options.resolver ? { resolver: options.resolver, resolverWriteScope } : {}) } });
  }
  program.steps.push(repair("assessment", kind === "migration" ? expr("outputCandidate", "integrate") : expr("candidateFromBaseline"), "final", "assess-first", kind === "review" ? [] : writeScope));
  if (acceptance.requireHumanApproval) program.steps.push({ kind: "waitEvent", id: "human-approval", options: {
    schema: options.approvalSchema!, type: "human-approval", correlation: `${program.id}:approval`, timeoutMs: policy.deadlineMs,
    subject: expr("object", { candidate: expr("acceptedCandidate", "assessment"), contract: expr("acceptance") }),
  } });
  program.steps.push({ kind: "gate", id: "final", options: {
    candidate: expr("acceptedCandidate", "assessment"), ...(kind === "migration" ? { coverage: expr("coverageReceipt", "migrate") } : {}),
    ...(acceptance.requireHumanApproval ? { authorization: expr("output", "human-approval") } : {}),
  } });
  return program;
}
