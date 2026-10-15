import { programBlock } from "./program-structure.ts";
import { programAssert, programDigest, registryEntry, validateProgramData, type ProgramOperation, type ProgramRegistry, type ProgramSchema, type ProgramLexicalContext, type WorkflowProgramV2 } from "./program-contract.ts";

/** Conservative finite inference: unknown schemas retain runtime validation. No JS evaluation. */
export function validateProgramTypes(program: WorkflowProgramV2, registry: ProgramRegistry, lexical: ProgramLexicalContext = {}, depth = 0): void {
  programAssert(depth <= 32, "Subworkflow type context depth exceeded");
  type Shape = ProgramSchema;
  interface Scope { steps: ProgramOperation[]; input: Shape; parent?: Scope; item?: Shape; state?: Shape }
  const cache = new Map<ProgramOperation, Shape>();
  const candidate: Shape = { type: "object", properties: { candidateId: { type: "string" }, digest: { type: "string" }, baselineDigest: { type: "string" }, parents: { type: "array" }, deltas: { type: "array" }, producerAttempts: { type: "array" } } };
  function types(shape: Shape): string[] { return shape.type ? Array.isArray(shape.type) ? shape.type : [shape.type] : []; }
  function compatible(actual: Shape, expected: Shape, label: string): void {
    if (Object.hasOwn(actual, "const")) { validateProgramData(actual.const, expected); return; }
    if (actual.anyOf) { for (const alternative of actual.anyOf) compatible(alternative, expected, label); return; }
    const a = types(actual), e = types(expected);
    if (a.length && e.length) programAssert(a.every(type => e.includes(type) || type === "integer" && e.includes("number")), `Incompatible type at ${label}`);
    if (actual.properties && expected.properties) for (const [key, value] of Object.entries(actual.properties)) {
      if (Object.hasOwn(expected.properties, key)) compatible(value, expected.properties[key], `${label}.${key}`);
      else programAssert(expected.additionalProperties !== false, `Unexpected field at ${label}.${key}`);
    }
    if (actual.required) for (const key of expected.required ?? []) programAssert(actual.required.includes(key), `Missing required field at ${label}.${key}`);
    if (actual.items && expected.items) compatible(actual.items, expected.items, `${label}[]`);
  }
  function constant(value: unknown): Shape {
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    return { type, const: value as never };
  }
  function reference(id: string, scope: Scope): Shape {
    const operation = scope.steps.find(step => step.id === id);
    if (operation) return operationShape(operation, scope);
    programAssert(scope.parent, `Unknown typed output ${id}`); return reference(id, scope.parent);
  }
  function infer(value: unknown, scope: Scope): Shape {
    if (!value || typeof value !== "object") return constant(value);
    if (Array.isArray(value)) return { type: "array", items: value.length ? { anyOf: value.map(entry => infer(entry, scope)) } : {}, minItems: value.length, maxItems: value.length };
    const record = value as Record<string, unknown>;
    if (!Object.hasOwn(record, "$expr")) return { type: "object", properties: Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, infer(entry, scope)])), required: Object.keys(record), additionalProperties: false };
    const name = String(record.$expr), args = record.args as unknown[];
    if (name === "literal") return constant(args[0]);
    if (name === "workflowInput") return scope.input;
    if (name === "item") { programAssert(scope.item, "item requires map context"); return scope.item; }
    if (name === "loopState") return scope.state ?? {};
    if (name === "output") return reference(String(args[0]), scope);
    if (["outputCandidate", "acceptedCandidate", "candidateFromBaseline"].includes(name)) return candidate;
    if (name === "acceptedCandidates") return { type: "array", items: candidate };
    if (name === "object") return infer(args[0], scope);
    if (name === "array") return { type: "array", items: args.length ? infer(args[0], scope) : {} };
    if (name === "field") {
      const input = infer(args[0], scope), key = String(args[1]);
      if (input.anyOf) {
        const alternatives = input.anyOf.map(alternative => {
          if (Object.hasOwn(alternative, "const")) { programAssert(alternative.const && typeof alternative.const === "object" && Object.hasOwn(alternative.const, key), `Field absent ${key} in branch merge`); return constant((alternative.const as Record<string, unknown>)[key]); }
          programAssert(!alternative.properties || Object.hasOwn(alternative.properties, key) || alternative.additionalProperties !== false, `Field absent ${key} in branch merge`); return alternative.properties?.[key] ?? {};
        });
        return { anyOf: alternatives };
      }
      if (Object.hasOwn(input, "const")) { programAssert(input.const && typeof input.const === "object" && Object.hasOwn(input.const, key), `Field absent ${key}`); return constant((input.const as Record<string, unknown>)[key]); }
      if (input.type) compatible(input, { type: "object" }, "field input");
      programAssert(!input.properties || Object.hasOwn(input.properties, key) || input.additionalProperties !== false, `Field absent ${key}`); return input.properties?.[key] ?? {};
    }
    if (["eq", "and", "or", "not"].includes(name)) return { type: "boolean" };
    if (name === "length") return { type: "integer" };
    if (["concat", "filter", "unique", "sort", "take"].includes(name)) { const input = infer(args[0], scope); if (input.type) compatible(input, { type: "array" }, `${name} input`); return { type: "array", items: input.items ?? {} }; }
    if (["acceptanceChecks", "approvedChecksFor", "acceptanceWriteScope"].includes(name)) return { type: "array", items: { type: "string" } };
    return {};
  }
  function operationShape(step: ProgramOperation, scope: Scope): Shape {
    const cached = cache.get(step); if (cached) return cached;
    const options = step.options; let shape: Shape = {};
    if (step.kind === "value") shape = infer(options.value, scope);
    if (step.kind === "agent" || step.kind === "command") {
      const executor = registryEntry(registry.executors, options.executor as never);
      if (executor.inputSchema) compatible(infer(options.input ?? {}, scope), registryEntry(registry.schemas, executor.inputSchema), `activity ${step.id} input`);
      shape = registryEntry(registry.schemas, executor.schema);
    }
    if (step.kind === "waitEvent") shape = registryEntry(registry.schemas, options.schema as never);
    if (step.kind === "subworkflow") {
      const child = registryEntry(registry.programs ?? {}, options.program as never);
      compatible(infer(options.input, scope), registryEntry(registry.schemas, child.inputSchema), `child ${step.id} input`);
      validateProgramTypes(child, registry, { item: scope.item, state: scope.state }, depth + 1);
      shape = registryEntry(registry.schemas, child.outputSchema);
    }
    if (step.kind === "branch") {
      compatible(infer(options.condition, scope), { type: "boolean" }, `branch ${step.id} condition`);
      const arms = ["then", "else"].map(arm => { const block = programBlock(options[arm]), steps = block.steps, child = { ...scope, steps, parent: scope }; for (const entry of steps) operationShape(entry, child); return infer(block.result, child); });
      const left = types(arms[0]), right = types(arms[1]);
      programAssert(!left.length || !right.length || programDigest(left) === programDigest(right), `Incompatible branch merge ${step.id}`);
      shape = { anyOf: arms, ...(left.length && right.length ? { type: left } : {}) };
    }
    if (step.kind === "map" || step.kind === "loop") {
      const steps = programBlock(options.body).steps;
      const items = step.kind === "map" ? infer(options.items, scope) : {}, state = step.kind === "loop" ? infer(options.initialState, scope) : {};
      if (step.kind === "map") compatible(items, { type: "array" }, `map ${step.id} items`);
      const child = { ...scope, steps, parent: scope, item: step.kind === "map" ? items.items ?? {} : scope.item, state: step.kind === "loop" ? state : scope.state };
      for (const entry of steps) operationShape(entry, child);
      infer(programBlock(options.body).result, child);
      if (step.kind === "loop") { compatible(infer(options.next, child), { type: state.type }, `loop ${step.id} state`); compatible(infer(options.until, child), { type: "boolean" }, `loop ${step.id} condition`); }
      shape = step.kind === "loop" ? state : { type: "object" };
    }
    if (["sequence", "parallel"].includes(step.kind)) {
      const block = programBlock(options), child = { ...scope, steps: block.steps, parent: scope };
      for (const entry of block.steps) operationShape(entry, child); shape = infer(block.result, child);
    }
    if (["repair", "compose", "gate"].includes(step.kind)) shape = { type: "object" };
    cache.set(step, shape); return shape;
  }
  const scope: Scope = { ...lexical, steps: program.steps, input: registryEntry(registry.schemas, program.inputSchema) };
  for (const step of program.steps) operationShape(step, scope);
  compatible(infer(program.result, scope), registryEntry(registry.schemas, program.outputSchema), "program result");
}
