import { programDigest, programValueBytes, programWithin, refKey, registryEntry, validateWorkflowProgram, type ProgramRegistry, type ProgramSchema, type WorkflowProgramV2 } from "./program-contract.ts";
import { programGraph } from "./program-structure.ts";
import { buildWorkflowTemplate, type ProgramTemplateKind, type ProgramTemplateOptions } from "./program-templates.ts";

export interface ProgramAuthorDiagnostic { code: string; message: string; operationId?: string }
export interface ProgramAuthorProposal {
  valid: boolean; program?: WorkflowProgramV2; digest?: string; diagnostics: ProgramAuthorDiagnostic[];
  summary?: { criteria: string[]; requiredChecks: string[]; writeScope: string[]; humanApproval: boolean; operations: { id: string; kind: string; dependencies: string[] }[] };
}
export function validateProgramProposal(program: WorkflowProgramV2, registry: ProgramRegistry): ProgramAuthorProposal {
  try {
    validateWorkflowProgram(program, registry);
    const acceptance = registryEntry(registry.acceptance, program.acceptance);
    const policy = registryEntry(registry.policies, program.policy);
    return { valid: true, program: structuredClone(program), digest: programDigest(program), diagnostics: [], summary: {
      criteria: [...acceptance.criteria], requiredChecks: [...new Set([...acceptance.requiredChecks, ...(acceptance.requiredChecksByScope?.item ?? []), ...(acceptance.requiredChecksByScope?.final ?? [])])],
      writeScope: [...new Set([...acceptance.writeScope, ...policy.writeScope])].filter(path => programWithin(path, acceptance.writeScope) && programWithin(path, policy.writeScope)), humanApproval: acceptance.requireHumanApproval === true,
      operations: programGraph(program).map(entry => ({ id: entry.id, kind: entry.step.kind, dependencies: entry.dependencies })),
    } };
  } catch (error) {
    return { valid: false, diagnostics: [{ code: (error as { code?: string }).code ?? "AF_PROGRAM_INVALID", message: error instanceof Error ? error.message : String(error) }] };
  }
}
export function proposeWorkflowTemplate(kind: ProgramTemplateKind, options: ProgramTemplateOptions, registry: ProgramRegistry): ProgramAuthorProposal {
  try { programValueBytes(options, 40000, 128); return validateProgramProposal(buildWorkflowTemplate(kind, options, registry), registry); }
  catch (error) { return { valid: false, diagnostics: [{ code: "AF_PROGRAM_TEMPLATE_INVALID", message: error instanceof Error ? error.message : String(error) }] }; }
}

/** Generate authoring declarations from the owner's schemas, without evaluating authored code. */
export function generateRegistryAuthorTypes(registry: ProgramRegistry): string {
  programValueBytes(registry, 4 * 1024 * 1024);
  const shape = (schema: ProgramSchema, depth = 0): string => {
    if (depth > 32) throw new Error("Schema depth exceeded");
    if (Object.hasOwn(schema, "const")) return JSON.stringify(schema.const);
    if (schema.enum?.length) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
    if (schema.anyOf?.length) return schema.anyOf.map(value => shape(value, depth + 1)).join(" | ");
    const types = schema.type ? Array.isArray(schema.type) ? schema.type : [schema.type] : [];
    if (!types.length) return "unknown";
    return types.map(type => {
      if (type === "object") return `{ ${[...Object.entries(schema.properties ?? {}).map(([key, value]) => `${JSON.stringify(key)}${schema.required?.includes(key) ? "" : "?"}: ${shape(value, depth + 1)}`), ...(schema.additionalProperties === false ? [] : ["[key: string]: unknown"])].join("; ")} }`;
      if (type === "array") return `Array<${shape(schema.items ?? {}, depth + 1)}>`;
      return type === "integer" ? "number" : type;
    }).join(" | ");
  };
  const schemas = Object.entries(registry.schemas).sort(([a], [b]) => a.localeCompare(b));
  const refs = (entries: Record<string, unknown>) => Object.keys(entries).sort().map(key => JSON.stringify(key)).join(" | ") || "never";
  return `// Generated owner registry authoring types; runtime owner validation remains authoritative.\nexport interface OwnerSchemas {\n${schemas.map(([key, value]) => `  ${JSON.stringify(key)}: ${shape(value)};`).join("\n")}\n}\nexport interface OwnerExecutors {\n${Object.entries(registry.executors).sort(([a], [b]) => a.localeCompare(b)).map(([key, executor]) => `  ${JSON.stringify(key)}: { input: ${executor.inputSchema ? `OwnerSchemas[${JSON.stringify(refKey(executor.inputSchema))}]` : "unknown"}; output: OwnerSchemas[${JSON.stringify(refKey(executor.schema))}] };`).join("\n")}\n}\nexport type OwnerPolicyKey = ${refs(registry.policies)};\nexport type OwnerAcceptanceKey = ${refs(registry.acceptance)};\n`;
}
