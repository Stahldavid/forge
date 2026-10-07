import { programAssert, type ProgramOperation, type WorkflowProgramV2 } from "./program-contract.ts";

export interface ProgramBlock { steps: ProgramOperation[]; result: unknown }
/** Only a single operation has a shorthand result. Arrays are not sequences. */
export function programBlock(value: unknown): ProgramBlock {
  if (value && typeof value === "object" && !Array.isArray(value) && "steps" in value) {
    const block = value as ProgramBlock;
    programAssert(Array.isArray(block.steps) && Object.hasOwn(block, "result"), "Block requires steps and explicit result"); return block;
  }
  const steps = Array.isArray(value) ? value : [value];
  programAssert(steps.length === 1 && steps[0] && typeof steps[0].id === "string", "Multiple operations require Block {steps,result}");
  return { steps, result: { $expr: "output", args: [steps[0].id] } };
}
export function canonicalItemKey(value: unknown): string {
  programAssert(typeof value === "string" && value.length > 0 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value), "Map key must be a valid Unicode string");
  const key = value.normalize("NFC"); programAssert(Buffer.byteLength(key) <= 256, "Map key byte limit exceeded"); return key;
}
export const compareProgramKeys = (a: string, b: string): number => Buffer.compare(Buffer.from(a), Buffer.from(b));
export const programSegment = (key: string): string => encodeURIComponent(canonicalItemKey(key)).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

export interface ProgramGraphEntry { id: string; step: ProgramOperation; dependencies: string[] }
/** Static templates, lexical references and control edges. No authored code executes. */
export function programGraph(program: WorkflowProgramV2): ProgramGraphEntry[] {
  const graph = new Map<string, ProgramGraphEntry>();
  function refs(value: unknown, resolve: (id: string) => string | undefined, dependencies: Set<string>): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const entry of value) refs(entry, resolve, dependencies); return; }
    const record = value as Record<string, unknown>;
    if (record.$expr === "literal") return;
    if (["output", "acceptedCandidate", "acceptedCandidates", "outputCandidate", "coverageReceipt"].includes(String(record.$expr))) {
      const id = (record.args as unknown[])[0]; programAssert(typeof id === "string", "Output ID required"); const target = resolve(id); programAssert(target, `Unknown output ${id}`); dependencies.add(target);
    }
    for (const child of Object.values(record)) refs(child, resolve, dependencies);
  }
  function scope(block: ProgramBlock, prefix: string, outer?: (id: string) => string | undefined, sequential = false): void {
    const resolve = (id: string) => block.steps.some(step => step.id === id) ? `${prefix}${id}` : outer?.(id);
    for (let index = 0; index < block.steps.length; index++) {
      const step = block.steps[index], id = `${prefix}${step.id}`, dependencies = new Set<string>();
      if (sequential && index) dependencies.add(`${prefix}${block.steps[index - 1].id}`);
      const after = step.options.after ?? []; programAssert(Array.isArray(after) && after.every(entry => typeof entry === "string"), "after requires operation IDs");
      for (const predecessor of after) { const target = resolve(predecessor); programAssert(target, `Unknown control predecessor ${predecessor}`); dependencies.add(target); }
      refs(Object.fromEntries(Object.entries(step.options).filter(([key]) => !["body", "steps", "result", "then", "else", "next", "until", "after"].includes(key))), resolve, dependencies);
      const children: { block: ProgramBlock; prefix: string; sequential?: boolean }[] = [];
      if (step.kind === "sequence" || step.kind === "parallel") children.push({ block: programBlock(step.options), prefix: `${id}/`, sequential: step.kind === "sequence" });
      if (step.kind === "map" || step.kind === "loop") children.push({ block: programBlock(step.options.body), prefix: `${id}/body/` });
      if (step.kind === "branch") for (const arm of ["then", "else"]) children.push({ block: programBlock(step.options[arm]), prefix: `${id}/${arm}/` });
      programAssert(!graph.has(id), "Duplicate operation ID"); graph.set(id, { id, step, dependencies: [] });
      for (const child of children) {
        scope(child.block, child.prefix, resolve, child.sequential);
        for (const entry of child.block.steps) dependencies.add(`${child.prefix}${entry.id}`);
        const childResolve = (target: string) => child.block.steps.some(entry => entry.id === target) ? `${child.prefix}${target}` : resolve(target);
        refs(child.block.result, childResolve, dependencies);
        if (step.kind === "loop") {
          refs(step.options.next, childResolve, dependencies); refs(step.options.until, childResolve, dependencies);
        }
      }
      graph.get(id)!.dependencies = [...dependencies];
    }
    refs(block.result, resolve, new Set());
  }
  scope({ steps: program.steps, result: program.result }, "");
  const visited = new Set<string>(), visiting = new Set<string>();
  function visit(id: string): void { programAssert(!visiting.has(id), `Dependency cycle ${id}`); if (visited.has(id)) return; visiting.add(id); for (const dependency of graph.get(id)?.dependencies ?? []) visit(dependency); visiting.delete(id); visited.add(id); }
  for (const id of graph.keys()) visit(id); return [...graph.values()];
}
