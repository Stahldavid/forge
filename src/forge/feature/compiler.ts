import { normalize, relative, resolve } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson, serializeCanonical } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { planMakeCommand } from "../make/index.ts";
import type { MakeCommandOptions, MakeFieldSpec, MakePrimitive } from "../make/types.ts";
import type {
  BlueprintField,
  FeatureBlueprint,
  FeatureChange,
  FeatureImpact,
  FeaturePlan,
  FeatureRisk,
  ResourceBlueprint,
} from "./types.ts";

const FIELD_TYPES = new Set<MakeFieldSpec["type"]>([
  "uuid",
  "text",
  "number",
  "integer",
  "boolean",
  "timestamp",
  "json",
  "enum",
  "ref",
]);

export const FEATURE_PLAN_DIR = ".forge/features/plans";
export const FEATURE_APPLIED_DIR = ".forge/features/applied";

function diagnostic(
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  file?: string,
): Diagnostic {
  return createDiagnostic({
    severity,
    code,
    message,
    ...(file ? { file } : {}),
  });
}

function absPath(workspaceRoot: string, file: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, normalize(file));
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`refusing to access outside workspace: ${file}`);
  }
  return absolute;
}

function readText(workspaceRoot: string, file: string): string | null {
  return nodeFileSystem.readText(absPath(workspaceRoot, file));
}

export function writeText(workspaceRoot: string, file: string, content: string): void {
  nodeFileSystem.writeText(absPath(workspaceRoot, file), content);
}

export function blueprintHash(blueprint: FeatureBlueprint): string {
  return `sha256:${hashStable(canonicalJson(blueprint))}`;
}

function featureId(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

export function parseFeatureBlueprint(
  workspaceRoot: string,
  blueprintPath: string,
): { blueprint?: FeatureBlueprint; diagnostics: Diagnostic[] } {
  const absolute = absPath(workspaceRoot, blueprintPath);
  const raw = nodeFileSystem.readText(absolute);
  if (raw === null) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `blueprint file not found: ${blueprintPath}`,
          blueprintPath,
        ),
      ],
    };
  }

  try {
    const parsed = JSON.parse(raw) as FeatureBlueprint;
    return { blueprint: parsed, diagnostics: validateFeatureBlueprint(workspaceRoot, parsed, blueprintPath) };
  } catch (error) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `blueprint must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          blueprintPath,
        ),
      ],
    };
  }
}

function validateName(name: unknown, what: string, diagnostics: Diagnostic[]): name is string {
  if (typeof name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        `${what} must be a non-empty identifier`,
      ),
    );
    return false;
  }
  return true;
}

function validateField(field: BlueprintField, diagnostics: Diagnostic[], prefix: string): void {
  validateName(field.name, `${prefix} field name`, diagnostics);
  if (!FIELD_TYPES.has(field.type)) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        `${prefix}.${field.name} has unsupported field type '${field.type}'`,
      ),
    );
  }
  if (field.type === "enum" && (!Array.isArray(field.values) || field.values.length === 0)) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        `${prefix}.${field.name} enum fields require values`,
      ),
    );
  }
  if (field.type === "ref" && field.refTable !== undefined && typeof field.refTable !== "string") {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        `${prefix}.${field.name} refTable must be a string`,
      ),
    );
  }
}

function validateResource(resource: ResourceBlueprint, diagnostics: Diagnostic[]): void {
  validateName(resource.name, "resource name", diagnostics);
  if (!Array.isArray(resource.fields)) {
    diagnostics.push(
      diagnostic("error", "FORGE_FEATURE_BLUEPRINT_INVALID", `resource '${resource.name}' requires fields[]`),
    );
    return;
  }
  const seen = new Set<string>();
  for (const field of resource.fields) {
    validateField(field, diagnostics, resource.name);
    if (seen.has(field.name)) {
      diagnostics.push(
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `resource '${resource.name}' defines duplicate field '${field.name}'`,
        ),
      );
    }
    seen.add(field.name);
  }
}

function schemaContainsTable(workspaceRoot: string, table: string): boolean {
  const schema =
    readText(workspaceRoot, "src/forge/schema.ts") ??
    readText(workspaceRoot, "src/schema.ts") ??
    "";
  return schema.includes(`name: "${table}"`) || schema.includes(`name: '${table}'`);
}

function validateChange(
  workspaceRoot: string,
  change: FeatureChange,
  createdTables: Set<string>,
  diagnostics: Diagnostic[],
): void {
  if (change.kind === "addField") {
    validateName(change.table, "change table", diagnostics);
    validateField(change.field, diagnostics, change.table);
    if (!createdTables.has(change.table) && !schemaContainsTable(workspaceRoot, change.table)) {
      diagnostics.push(
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `change references missing table '${change.table}'`,
        ),
      );
    }
  }
  if ("name" in change) {
    validateName(change.name, `${change.kind} name`, diagnostics);
  }
  if ("table" in change && typeof change.table === "string") {
    if (!createdTables.has(change.table) && !schemaContainsTable(workspaceRoot, change.table)) {
      diagnostics.push(
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `${change.kind} references missing table '${change.table}'`,
        ),
      );
    }
  }
}

export function validateFeatureBlueprint(
  workspaceRoot: string,
  blueprint: FeatureBlueprint,
  file?: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (blueprint.schemaVersion !== "0.1.0") {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        "blueprint schemaVersion must be '0.1.0'",
        file,
      ),
    );
  }
  validateName(blueprint.name, "feature name", diagnostics);
  if (blueprint.mode !== undefined && blueprint.mode !== "create" && blueprint.mode !== "modify") {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        "blueprint mode must be create or modify",
        file,
      ),
    );
  }
  const resources = blueprint.resources ?? [];
  const changes = blueprint.changes ?? [];
  if (resources.length === 0 && changes.length === 0) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_FEATURE_BLUEPRINT_INVALID",
        "blueprint requires resources[] or changes[]",
        file,
      ),
    );
  }
  const createdTables = new Set<string>();
  for (const resource of resources) {
    validateResource(resource, diagnostics);
    if (createdTables.has(resource.name)) {
      diagnostics.push(
        diagnostic(
          "error",
          "FORGE_FEATURE_BLUEPRINT_INVALID",
          `duplicate resource '${resource.name}'`,
          file,
        ),
      );
    }
    createdTables.add(resource.name);
  }
  for (const change of changes) {
    validateChange(workspaceRoot, change, createdTables, diagnostics);
  }
  return diagnostics;
}

function fieldToRaw(field: BlueprintField): string {
  const type =
    field.type === "enum"
      ? `enum(${(field.values ?? []).join(",")})`
      : field.type === "ref"
        ? `ref(${field.refTable ?? field.name.replace(/Id$/, "s")})`
        : field.type;
  return [
    `${field.name}:${type}`,
    field.required ? "required" : "",
    field.optional ? "optional" : "",
    field.default !== undefined ? `default=${String(field.default)}` : "",
    field.defaultNow ? "defaultNow" : "",
    field.unique ? "unique" : "",
    field.indexed ? "index" : "",
  ].filter(Boolean).join(":");
}

function baseMakeOptions(
  workspaceRoot: string,
  primitive: MakePrimitive,
  name?: string,
): MakeCommandOptions {
  return {
    primitive,
    name,
    workspaceRoot,
    json: true,
    dryRun: true,
    plan: false,
    apply: false,
    yes: false,
    force: false,
    noGenerate: true,
    noVerify: true,
    keepFailed: false,
    tenantScoped: false,
    fieldSpecs: [],
    index: false,
    withAi: false,
    withCrud: false,
    withLiveQuery: false,
    withReact: false,
    withTests: false,
    withCreateForm: false,
  };
}

function resourcePolicyRoles(resource: ResourceBlueprint): string | undefined {
  const roles = new Set<string>();
  for (const values of Object.values(resource.policies ?? {})) {
    for (const role of values ?? []) {
      roles.add(role);
    }
  }
  if (roles.size === 0) {
    return undefined;
  }
  return [...roles].sort().join(",");
}

export function compileFeatureBlueprint(
  workspaceRoot: string,
  blueprint: FeatureBlueprint,
): MakeCommandOptions[] {
  const options: MakeCommandOptions[] = [];
  for (const resource of blueprint.resources ?? []) {
    options.push({
      ...baseMakeOptions(workspaceRoot, "resource", resource.name),
      tenantScoped: resource.tenantScoped ?? true,
      fieldsRaw: resource.fields.map(fieldToRaw).join(","),
      roles: resourcePolicyRoles(resource),
      withCrud: resource.crud ?? true,
      withLiveQuery: resource.liveQuery ?? resource.liveQueries?.list ?? true,
      withReact: resource.react ?? resource.frontend?.react ?? false,
      withTests: resource.tests === true || typeof resource.tests === "object",
      withCreateForm: resource.frontend?.components?.includes("createForm") ?? true,
    });
  }

  for (const change of blueprint.changes ?? []) {
    if (change.kind === "addField") {
      const raw = fieldToRaw(change.field);
      options.push({
        ...baseMakeOptions(workspaceRoot, "field", `${change.table}.${change.field.name}`),
        table: change.table,
        type: change.field.type,
        values: change.field.values?.join(","),
        defaultValue: change.field.default !== undefined ? String(change.field.default) : undefined,
        index: change.field.indexed ?? false,
        fieldSpecs: [raw],
      });
    } else if (change.kind === "addPolicy") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "policy", change.name),
        roles: change.roles.join(","),
      });
    } else if (change.kind === "addCommand") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "command", change.name),
        table: change.table,
        policy: change.policy,
        emit: change.emits,
      });
    } else if (change.kind === "addQuery") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "query", change.name),
        table: change.table,
        policy: change.policy,
      });
    } else if (change.kind === "addLiveQuery") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "livequery", change.name),
        table: change.table,
        policy: change.policy,
      });
    } else if (change.kind === "addAction") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "action", change.name),
        table: change.table,
        event: change.event,
      });
    } else if (change.kind === "addWorkflow") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "workflow", change.name),
        table: change.table,
        trigger: change.trigger,
        withAi: change.withAi ?? false,
      });
    } else if (change.kind === "addComponent") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "component", change.name),
        table: change.table,
        component: change.name,
      });
    } else if (change.kind === "updateFrontend") {
      options.push({
        ...baseMakeOptions(workspaceRoot, "page", change.page ?? change.table),
        table: change.table,
        withCreateForm: true,
      });
    }
  }
  return options;
}

function emptyImpact(): FeatureImpact {
  return {
    data: { tablesAdded: [], tablesModified: [], fieldsAdded: [] },
    runtime: {
      commandsAdded: [],
      queriesAdded: [],
      liveQueriesAdded: [],
      actionsAdded: [],
      workflowsAdded: [],
    },
    frontend: { pagesAdded: [], componentsAdded: [] },
    policies: { policiesAdded: [], policiesModified: [] },
    tests: { testsAdded: [] },
  };
}

function pushUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

function impactFromBlueprint(blueprint: FeatureBlueprint, makeOptions: MakeCommandOptions[]): FeatureImpact {
  const impact = emptyImpact();
  for (const resource of blueprint.resources ?? []) {
    pushUnique(impact.data.tablesAdded, resource.name);
    for (const field of resource.fields) {
      pushUnique(impact.data.fieldsAdded, `${resource.name}.${field.name}`);
    }
    for (const action of ["create", "update", "delete"]) {
      pushUnique(impact.policies.policiesAdded, `${resource.name}.${action}`);
    }
    pushUnique(impact.policies.policiesAdded, `${resource.name}.read`);
  }
  for (const option of makeOptions) {
    if (option.primitive === "command" || option.primitive === "resource") {
      if (option.primitive === "resource" && option.name) {
        pushUnique(impact.runtime.commandsAdded, `create${option.name}`);
        pushUnique(impact.runtime.commandsAdded, `update${option.name}`);
        pushUnique(impact.runtime.commandsAdded, `delete${option.name}`);
      } else if (option.name) {
        pushUnique(impact.runtime.commandsAdded, option.name);
      }
    }
    if (option.primitive === "query" && option.name) {
      pushUnique(impact.runtime.queriesAdded, option.name);
    }
    if (option.primitive === "livequery" && option.name) {
      pushUnique(impact.runtime.liveQueriesAdded, option.name);
    }
    if (option.primitive === "action" && option.name) {
      pushUnique(impact.runtime.actionsAdded, option.name);
    }
    if (option.primitive === "workflow" && option.name) {
      pushUnique(impact.runtime.workflowsAdded, option.name);
    }
    if (option.primitive === "component" && option.name) {
      pushUnique(impact.frontend.componentsAdded, option.name);
    }
    if (option.primitive === "page" && option.name) {
      pushUnique(impact.frontend.pagesAdded, option.name);
    }
    if (option.primitive === "field" && option.table && option.name) {
      pushUnique(impact.data.tablesModified, option.table);
      pushUnique(impact.data.fieldsAdded, option.name);
    }
  }
  return impact;
}

function riskFromBlueprint(blueprint: FeatureBlueprint, makePlans: import("../make/types.ts").MakePlan[]): FeatureRisk {
  const reasons: string[] = [];
  let level: FeatureRisk["level"] = "low";
  if ((blueprint.resources ?? []).length > 0) {
    level = "medium";
    reasons.push("adds resource schema and runtime entries");
  }
  for (const change of blueprint.changes ?? []) {
    if (change.kind === "addField") {
      if (change.field.required && !change.field.optional && change.field.default === undefined) {
        level = "high";
        reasons.push(`adds required field ${change.table}.${change.field.name} without a default`);
      } else {
        level = level === "low" ? "medium" : level;
        reasons.push(`adds field ${change.table}.${change.field.name}`);
      }
    }
    if (change.kind === "addPolicy") {
      level = "high";
      reasons.push(`modifies policy surface with ${change.name}`);
    }
    if (change.kind === "addCommand") {
      level = level === "low" ? "medium" : level;
      reasons.push(`adds command ${change.name}`);
    }
  }
  for (const plan of makePlans) {
    if (plan.risk.level === "high") {
      level = "high";
    } else if (plan.risk.level === "medium" && level === "low") {
      level = "medium";
    }
    for (const reason of plan.risk.reasons) {
      pushUnique(reasons, reason);
    }
  }
  if (blueprint.metadata?.risk === "high") {
    level = "high";
    reasons.push("blueprint metadata marks risk high");
  } else if (blueprint.metadata?.risk === "medium" && level === "low") {
    level = "medium";
  }
  return { level, reasons: reasons.sort() };
}

export function buildFeaturePlan(
  workspaceRoot: string,
  blueprint: FeatureBlueprint,
): FeaturePlan {
  const makeOptions = compileFeatureBlueprint(workspaceRoot, blueprint);
  const makeResults = makeOptions.map((option) => planMakeCommand(option));
  const makePlans = makeResults.map((result) => result.plan).filter((plan): plan is NonNullable<typeof plan> => Boolean(plan));
  const diagnostics = [
    ...validateFeatureBlueprint(workspaceRoot, blueprint),
    ...makeResults.flatMap((result) => result.diagnostics),
  ];
  const id = featureId(blueprint.name);
  const hash = blueprintHash(blueprint);
  const filesToCreate = makePlans.flatMap((plan) => plan.filesToCreate);
  const filesToModify = makePlans.flatMap((plan) => plan.filesToModify);
  const filesToDelete = makePlans.flatMap((plan) => plan.filesToDelete);
  const trackedFiles = [
    ...filesToCreate.map((file) => file.file),
    ...filesToModify.map((patch) => patch.file),
    ...filesToDelete.map((file) => file.file),
  ].filter((value, index, array) => array.indexOf(value) === index).sort();

  return {
    schemaVersion: "0.1.0",
    plannerVersion: GENERATOR_VERSION,
    id,
    blueprintName: blueprint.name,
    blueprintHash: hash,
    summary: blueprint.description ?? `Feature ${blueprint.name}`,
    makeIntents: makePlans.map((plan) => plan.intent),
    makeOptions,
    makePlans,
    filesToCreate,
    filesToModify,
    filesToDelete,
    impact: impactFromBlueprint(blueprint, makeOptions),
    risk: riskFromBlueprint(blueprint, makePlans),
    commandsToRun: ["forge generate", "forge verify --strict"],
    diagnostics,
    rollback: {
      trackedFiles,
      instructions: [`forge feature rollback ${id}`],
    },
  };
}

export function writeFeaturePlan(workspaceRoot: string, plan: FeaturePlan): string {
  const planPath = `${FEATURE_PLAN_DIR}/${plan.id}/plan.json`;
  writeText(workspaceRoot, planPath, serializeCanonical(plan));
  writeText(workspaceRoot, `${FEATURE_PLAN_DIR}/${plan.id}/plan.md`, renderFeaturePlanMarkdown(plan));
  return planPath;
}

export function renderFeaturePlanMarkdown(plan: FeaturePlan): string {
  return `# Feature plan: ${plan.blueprintName}

${plan.summary}

Risk: ${plan.risk.level}

## Creates

${plan.filesToCreate.map((file) => `- ${file.file}`).join("\n") || "- none"}

## Modifies

${plan.filesToModify.map((patch) => `- ${patch.file}`).join("\n") || "- none"}

## Commands

${plan.commandsToRun.map((command) => `- ${command}`).join("\n") || "- none"}
`;
}

export function renderFeatureDiff(plan: FeaturePlan): string {
  const lines: string[] = [];
  for (const file of plan.filesToCreate) {
    lines.push(`diff --forge-feature ${file.file}`, `+++ ${file.file}`);
    for (const line of file.content.split(/\r?\n/)) {
      lines.push(`+${line}`);
    }
  }
  for (const patch of plan.filesToModify) {
    lines.push(`diff --forge-feature ${patch.file}`, `--- ${patch.file}`, `+++ ${patch.file}`);
    for (const line of patch.afterPreview.split(/\r?\n/).slice(0, 80)) {
      lines.push(`+${line}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export function readFeaturePlan(workspaceRoot: string, featureIdOrPath: string): FeaturePlan | null {
  const candidates = [
    featureIdOrPath,
    `${FEATURE_PLAN_DIR}/${featureIdOrPath}/plan.json`,
  ];
  for (const candidate of candidates) {
    const content = readText(workspaceRoot, candidate);
    if (content) {
      return JSON.parse(content) as FeaturePlan;
    }
  }
  return null;
}

export function normalizeFeatureId(name: string): string {
  return featureId(name);
}
