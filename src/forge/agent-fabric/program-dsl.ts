import type { WorkflowRef, WorkflowOptions, WorkflowOperation, WorkflowDefinition, WorkflowExpression, WorkflowValue, WorkflowResolved, WorkflowActivityOptions, WorkflowBody, WorkflowCollection } from "./program-api.ts";
export type { WorkflowRef, WorkflowOptions, WorkflowOperation, WorkflowDefinition, WorkflowExpression, WorkflowValue, WorkflowResolved, WorkflowActivityOptions, WorkflowBody, WorkflowCollection } from "./program-api.ts";
import ts from "typescript";
import { programAssert, programValueBytes, type ProgramExpr, type ProgramOperation, type WorkflowProgramV2 } from "./program-contract.ts";

export const PROGRAM_DSL_VERSION = "forge-workflow-dsl/2";
export const expressionNames = ["workflowInput", "item", "loopState", "output", "field", "literal", "object", "array", "eq", "and", "or", "not", "concat", "filter", "unique", "sort", "take", "length", "population", "acceptance", "acceptedCandidate", "acceptedCandidates", "outputCandidate", "candidateFromBaseline", "coverageFor", "coverageReceipt", "acceptanceWriteScope", "approvedChecksFor", "acceptanceChecks"];
export const referenceNames = ["schemaRef", "executorRef", "policyRef", "acceptanceRef", "populationRef", "recipeRef", "programRef"];
export const operationNames = ["agent", "command", "map", "branch", "loop", "compose", "gate", "repair", "subworkflow", "waitEvent", "value", "sequence", "parallel"];
export function workflowExpression(name: string, ...args: unknown[]): ProgramExpr { return { $expr: name, args }; }
export function workflowOperation(kind: string, id: string, options: Record<string, unknown>): ProgramOperation { return { kind, id, options }; }
export function schemaRef<T = unknown>(id: string, version: string): WorkflowRef<"schema", unknown, T> { return { id, version } as WorkflowRef<"schema", unknown, T>; }
export const executorRef = <Input = unknown, Output = unknown>(id: string, version: string) => ({ id, version } as WorkflowRef<"executor", Input, Output>);
export const policyRef = (id: string, version: string) => ({ id, version } as WorkflowRef<"policy">);
export const acceptanceRef = (id: string, version: string) => ({ id, version } as WorkflowRef<"acceptance">);
export const populationRef = (id: string, version: string) => ({ id, version } as WorkflowRef<"population">);
export const recipeRef = (id: string, version: string) => ({ id, version } as WorkflowRef<"recipe">);
export const programRef = <Input = unknown, Output = unknown>(id: string, version: string) => ({ id, version } as WorkflowRef<"program", Input, Output>);
export const workflowInput = <T = unknown>() => workflowExpression("workflowInput") as WorkflowExpression<T>;
export const item = <T = unknown>() => workflowExpression("item") as WorkflowExpression<T>;
export const loopState = <T = unknown>() => workflowExpression("loopState") as WorkflowExpression<T>;
export function output<T>(operation: WorkflowOperation<keyof WorkflowOptions, T>): WorkflowExpression<T>;
export function output(id: string): WorkflowExpression;
export function output(operation: string | WorkflowOperation): WorkflowExpression { return workflowExpression("output", typeof operation === "string" ? operation : operation.id); }
export function field<T, K extends (unknown extends T ? string : keyof T & string)>(value: WorkflowExpression<T>, key: K): WorkflowExpression<unknown extends T ? unknown : T[K & keyof T]>;
export function field<T, K extends keyof T & string>(value: T, key: K): WorkflowExpression<T[K]>;
export function field(value: unknown, key: string): WorkflowExpression { return workflowExpression("field", value, key); }
export const literal = <T>(value: T) => workflowExpression("literal", value) as WorkflowExpression<T>;
export const object = <T extends Record<string, unknown>>(value: T) => workflowExpression("object", value) as WorkflowExpression<WorkflowResolved<T>>;
export const array = <T extends unknown[]>(...values: T) => workflowExpression("array", ...values) as WorkflowExpression<WorkflowResolved<T>>;
export const eq = (left: unknown, right: unknown) => workflowExpression("eq", left, right);
export const and = (...values: unknown[]) => workflowExpression("and", ...values);
export const or = (...values: unknown[]) => workflowExpression("or", ...values);
export const not = (value: unknown) => workflowExpression("not", value);
export const concat = (...values: unknown[]) => workflowExpression("concat", ...values);
export const filter = (values: unknown, key: string, equals: unknown) => workflowExpression("filter", values, key, equals);
export const unique = (values: unknown, key: string) => workflowExpression("unique", values, key);
export const sort = (values: unknown, key: string) => workflowExpression("sort", values, key);
export const take = (values: unknown, count: number) => workflowExpression("take", values, count);
export const length = (value: unknown) => workflowExpression("length", value);
export const population = () => workflowExpression("population");
export const acceptance = () => workflowExpression("acceptance");
export const acceptedCandidate = (id: string) => workflowExpression("acceptedCandidate", id);
export const acceptedCandidates = (id: string) => workflowExpression("acceptedCandidates", id);
export const outputCandidate = (id: string) => workflowExpression("outputCandidate", id);
export const candidateFromBaseline = (entry?: unknown) => entry === undefined ? workflowExpression("candidateFromBaseline") : workflowExpression("candidateFromBaseline", entry);
export const coverageFor = (contract: unknown, discovered: unknown) => workflowExpression("coverageFor", contract, discovered);
export const coverageReceipt = (id: string) => workflowExpression("coverageReceipt", id);
export const acceptanceWriteScope = (id: string) => workflowExpression("acceptanceWriteScope", id);
export const approvedChecksFor = (entry: unknown) => workflowExpression("approvedChecksFor", entry);
export const acceptanceChecks = (id: string) => workflowExpression("acceptanceChecks", id);
export const agent = <Input = unknown, Output = unknown>(id: string, options: WorkflowActivityOptions<Input, Output>) => workflowOperation("agent", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"agent", Output>;
export const command = <Input = unknown, Output = unknown>(id: string, options: WorkflowActivityOptions<Input, Output>) => workflowOperation("command", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"command", Output>;
export const map = <T = unknown>(id: string, options: Omit<WorkflowOptions["map"], "body"> & { body: WorkflowBody<T> }) => workflowOperation("map", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"map", WorkflowCollection<T>>;
export const branch = (id: string, options: WorkflowOptions["branch"]) => workflowOperation("branch", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"branch">;
export const loop = (id: string, options: WorkflowOptions["loop"]) => workflowOperation("loop", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"loop">;
export const compose = (id: string, options: WorkflowOptions["compose"]) => workflowOperation("compose", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"compose">;
export const gate = (id: string, options: WorkflowOptions["gate"]) => workflowOperation("gate", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"gate">;
export const repair = (id: string, options: WorkflowOptions["repair"]) => workflowOperation("repair", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"repair">;
export const subworkflow = <Input = unknown, Output = unknown>(id: string, options: Omit<WorkflowOptions["subworkflow"], "program" | "input"> & { program: WorkflowRef<"program", Input, Output>; input: WorkflowValue<NoInfer<Input>> }) => workflowOperation("subworkflow", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"subworkflow", Output>;
export const waitEvent = <T = unknown>(id: string, options: Omit<WorkflowOptions["waitEvent"], "schema"> & { schema: WorkflowRef<"schema", unknown, T> }) => workflowOperation("waitEvent", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"waitEvent", T>;
export const value = <T>(id: string, options: Omit<WorkflowOptions["value"], "value"> & { value: T }) => workflowOperation("value", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"value", WorkflowResolved<T>>;
export function defineWorkflow(program: WorkflowDefinition): WorkflowProgramV2 { return { schemaVersion: 2, operatorVersion: 2, ...program }; }

/** Parse a finite AST. Never transpile, import, evaluate, or call authored JavaScript. */
export const sequence = (id: string, options: WorkflowOptions["sequence"]) => workflowOperation("sequence", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"sequence">;
export const parallel = (id: string, options: WorkflowOptions["parallel"]) => workflowOperation("parallel", id, options as unknown as Record<string, unknown>) as WorkflowOperation<"parallel">;
export function lowerWorkflowSource(source: string): WorkflowProgramV2 {
  programAssert(Buffer.byteLength(source) <= 256 * 1024, "DSL source too large");
  const file = ts.createSourceFile("workflow.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  programAssert((file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length === 0, "Malformed workflow source");
  const bindings = new Map<string, unknown>(), imports = new Map<string, string>(); let program: WorkflowProgramV2 | undefined, nodes = 0, bindingBytes = 0;
  function evaluateList(entries: readonly ts.Expression[], depth: number): unknown[] { let bytes = 0; const values: unknown[] = []; for (const entry of entries) { const value = evaluate(entry, depth); bytes += programValueBytes(value, 4 * 1024 * 1024); programAssert(bytes <= 4 * 1024 * 1024, "DSL expansion byte budget exceeded"); values.push(value); } return values; }
  function evaluate(node: ts.Expression, depth = 0): unknown {
    programAssert(++nodes <= 100000 && depth <= 32, "DSL AST budget exceeded");
    const next = (expression: ts.Expression) => evaluate(expression, depth + 1);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (node.kind === ts.SyntaxKind.NullKeyword) return null;
    if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(node.operand)) return -Number(node.operand.text);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return next(node.expression);
    if (ts.isIdentifier(node)) { programAssert(bindings.has(node.text), `Unknown binding ${node.text}`); programValueBytes(bindings.get(node.text), 4 * 1024 * 1024); return structuredClone(bindings.get(node.text)); }
    if (ts.isArrayLiteralExpression(node)) { programAssert(node.elements.every(element => !ts.isSpreadElement(element)), "Spread forbidden"); return evaluateList(node.elements, depth + 1); }
    if (ts.isObjectLiteralExpression(node)) {
      const object: Record<string, unknown> = Object.create(null), explicit = new Set<string>(); let bytes = 0;
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) {
          programAssert(ts.isIdentifier(property.expression) && bindings.has(property.expression.text), "Only finite const data object spreads allowed");
          const spread = bindings.get(property.expression.text); programAssert(spread && typeof spread === "object" && !Array.isArray(spread) && !Object.hasOwn(spread, "$expr"), "Object spread requires const data");
          bytes += programValueBytes(spread, 4 * 1024 * 1024); programAssert(bytes <= 4 * 1024 * 1024, "DSL expansion byte budget exceeded"); Object.assign(object, structuredClone(spread)); continue;
        }
        programAssert(ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)), "Only literal data properties allowed");
        const key = property.name.text; programAssert(!explicit.has(key) && !["__proto__", "prototype", "constructor"].includes(key), "Duplicate/protected DSL key"); explicit.add(key); const value = next(property.initializer); bytes += Buffer.byteLength(key) + programValueBytes(value, 4 * 1024 * 1024); programAssert(bytes <= 4 * 1024 * 1024, "DSL expansion byte budget exceeded"); object[key] = value;
      }
      return object;
    }
    if (ts.isCallExpression(node)) {
      programAssert(ts.isIdentifier(node.expression), "Only DSL constructors allowed");
      const name = imports.get(node.expression.text); programAssert(name, `Unimported constructor ${node.expression.text}`);
      const args = evaluateList(node.arguments, depth + 1);
      if (expressionNames.includes(name)) { if (name === "output" && args[0] && typeof args[0] === "object" && "kind" in args[0]) args[0] = (args[0] as ProgramOperation).id; return { $expr: name, args }; }
      if (referenceNames.includes(name)) { programAssert(args.length === 2 && args.every(arg => typeof arg === "string"), "Versioned registry reference required"); return { id: args[0], version: args[1] }; }
      if (operationNames.includes(name)) { programAssert(args.length === 2 && typeof args[0] === "string" && args[1] && typeof args[1] === "object", "Operation ID and options required"); return { kind: name, id: args[0], options: args[1] }; }
      programAssert(name === "defineWorkflow" && args.length === 1 && args[0] && typeof args[0] === "object", "Invalid workflow constructor"); return { schemaVersion: 2, operatorVersion: 2, ...args[0] };
    }
    programAssert(false, `Unsupported authored syntax ${ts.SyntaxKind[node.kind]}`);
  }
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      programAssert(ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === "forgeos/agent-fabric/workflows" && statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings), "Only versioned Forge DSL named imports allowed");
      for (const element of statement.importClause.namedBindings.elements) {
        const name = element.propertyName?.text ?? element.name.text;
        if (statement.importClause.isTypeOnly || element.isTypeOnly) { programAssert(["WorkflowOptions", "WorkflowRef", "WorkflowOperation", "WorkflowDefinition", "WorkflowExpression", "WorkflowValue", "WorkflowResolved", "WorkflowActivityOptions", "WorkflowBody", "WorkflowCollection"].includes(name), "Unknown DSL author type"); continue; }
        programAssert(["defineWorkflow", ...expressionNames, ...referenceNames, ...operationNames].includes(name) && !imports.has(element.name.text), "Unknown/duplicate DSL import"); imports.set(element.name.text, name);
      }
    } else if (ts.isVariableStatement(statement)) {
      programAssert((statement.declarationList.flags & ts.NodeFlags.Const) !== 0, "Only const bindings allowed");
      for (const declaration of statement.declarationList.declarations) { programAssert(ts.isIdentifier(declaration.name) && declaration.initializer && !bindings.has(declaration.name.text) && !imports.has(declaration.name.text), "Invalid const declaration"); const value = evaluate(declaration.initializer); bindingBytes += programValueBytes(value, 4 * 1024 * 1024); programAssert(bindingBytes <= 4 * 1024 * 1024, "DSL cumulative binding budget exceeded"); bindings.set(declaration.name.text, value); }
    } else if (ts.isExportAssignment(statement)) {
      programAssert(!program && !statement.isExportEquals, "Only one export default workflow allowed"); program = evaluate(statement.expression) as WorkflowProgramV2;
    } else programAssert(false, "Only DSL imports, const data bindings, and export default allowed");
  }
  programAssert(program?.schemaVersion === 2, "export default defineWorkflow required"); programValueBytes(program, 4 * 1024 * 1024); return program;
}
