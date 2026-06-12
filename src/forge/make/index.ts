import { dirname, normalize, relative, resolve } from "node:path";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import type { FileSystem } from "../compiler/fs/index.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { GENERATOR_VERSION } from "../compiler/emitter/constants.ts";
import { hashStable } from "../compiler/primitives/hash.ts";
import { canonicalJson, serializeCanonical } from "../compiler/primitives/serialize.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { parseFieldSpec, parseFields, splitTopLevel } from "./fields.ts";
import { camelCase, kebabCase, pascalCase, singularize, titleCase } from "./naming.ts";
import {
  renderAction,
  renderCreateCommand,
  renderCreateForm,
  renderDeleteCommand,
  renderGetQuery,
  renderListComponent,
  renderListQuery,
  renderLiveQuery,
  renderPage,
  renderPlaceholderTest,
  renderPolicyFile,
  renderSchemaTable,
  renderUpdateCommand,
  renderViteApp,
  renderViteIndex,
  renderViteMain,
  renderVitePackage,
  renderViteStyles,
  renderViteTsconfig,
  renderWebBridge,
  renderWebRootBridge,
  renderWorkflow,
} from "./templates.ts";
import type {
  MakeCommandOptions,
  MakeFieldSpec,
  MakeIntent,
  MakePlan,
  MakePrimitive,
  MakeResult,
  PlannedFile,
  PlannedPatch,
} from "./types.ts";

export const MAKE_PRIMITIVES: MakePrimitive[] = [
  "list",
  "explain",
  "table",
  "field",
  "policy",
  "command",
  "query",
  "livequery",
  "action",
  "workflow",
  "component",
  "page",
  "ui",
  "resource",
  "apply",
  "rollback",
];

const AUTHORING_PRIMITIVES = MAKE_PRIMITIVES.filter(
  (primitive) => !["list", "explain", "apply", "rollback"].includes(primitive),
) as Array<MakeIntent["kind"]>;

const PLAN_DIR = ".forge/make-plans";

interface SnapshotFile {
  file: string;
  existed: boolean;
  content?: string;
}

interface MakeSnapshot {
  schemaVersion: "0.1.0";
  planId: string;
  files: SnapshotFile[];
}

const EXPLANATIONS: Record<MakeIntent["kind"], string> = {
  table:
    "Adds a Forge schema table in src/forge/schema.ts. Use --fields for user fields and --tenant-scoped for tenant isolation.",
  field:
    "Adds a field to an existing table. Use table.field as the name or pass --table and --type.",
  policy:
    "Adds a named policy in src/policies.ts using canRole(...roles).",
  command:
    "Adds a transactional command under src/commands with explicit auth and optional ctx.emit.",
  query:
    "Adds a read-only query under src/queries with explicit auth.",
  livequery:
    "Adds a read-only liveQuery under src/queries for reactive clients.",
  action:
    "Adds an after-commit action under src/actions subscribed to an event.",
  workflow:
    "Adds a durable workflow under src/workflows triggered by an event.",
  component:
    "Adds a React client component under web/components wired to generated Forge hooks.",
  page:
    "Adds a minimal app page under web/app/<route>/page.tsx.",
  ui:
    "Adds a minimal Vite React web app with ForgeProvider devAuth and a generated client bridge.",
  resource:
    "Creates a full resource slice: table, policies, CRUD commands, queries, liveQuery, action, optional React, and tests.",
};

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

function okResult(partial: Omit<MakeResult, "ok" | "diagnostics" | "exitCode">): MakeResult {
  return { ok: true, diagnostics: [], exitCode: 0, ...partial };
}

function failResult(diagnostics: Diagnostic[], plan?: MakePlan): MakeResult {
  return { ok: false, plan, diagnostics, exitCode: 1 };
}

function normalizeRel(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\/+/, "");
}

function absPath(workspaceRoot: string, file: string): string {
  const root = resolve(workspaceRoot);
  const absolute = resolve(root, normalize(file));
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || resolve(rel) === rel) {
    throw new Error(`refusing to write outside workspace: ${file}`);
  }
  return absolute;
}

function readIfExists(
  workspaceRoot: string,
  file: string,
  fs: FileSystem = nodeFileSystem,
): string | null {
  return fs.readText(absPath(workspaceRoot, file));
}

function writeText(
  workspaceRoot: string,
  file: string,
  content: string,
  fs: FileSystem = nodeFileSystem,
): void {
  fs.writeText(absPath(workspaceRoot, file), content);
}

function fileExists(
  workspaceRoot: string,
  file: string,
  fs: FileSystem = nodeFileSystem,
): boolean {
  return fs.exists(absPath(workspaceRoot, file));
}

function removeFile(
  workspaceRoot: string,
  file: string,
  fs: FileSystem = nodeFileSystem,
): void {
  fs.remove(absPath(workspaceRoot, file));
}

function chooseSchemaFile(workspaceRoot: string): string {
  if (fileExists(workspaceRoot, "src/forge/schema.ts")) {
    return "src/forge/schema.ts";
  }
  if (fileExists(workspaceRoot, "src/schema.ts")) {
    return "src/schema.ts";
  }
  return "src/forge/schema.ts";
}

function choosePolicyFile(workspaceRoot: string): string {
  if (fileExists(workspaceRoot, "src/policies.ts")) {
    return "src/policies.ts";
  }
  if (fileExists(workspaceRoot, "src/forge/policies.ts")) {
    return "src/forge/policies.ts";
  }
  return "src/policies.ts";
}

function ensureSchemaImport(content: string): string {
  if (content.includes("defineTable")) {
    return content;
  }
  return `import { defineTable } from "forge/server";\n\n${content}`;
}

function appendSchemaTable(
  workspaceRoot: string,
  tableName: string,
  fields: MakeFieldSpec[],
  tenantScoped: boolean,
): { patch?: PlannedPatch; diagnostics: Diagnostic[] } {
  const file = chooseSchemaFile(workspaceRoot);
  const existing = readIfExists(workspaceRoot, file);
  const rendered = renderSchemaTable(tableName, fields, tenantScoped);
  const diagnostics: Diagnostic[] = [];
  const base = existing ?? "";

  if (
    new RegExp(`name:\\s*["']${tableName}["']`).test(base) ||
    new RegExp(`export\\s+const\\s+${camelCase(tableName)}\\b`).test(base)
  ) {
    diagnostics.push(
      diagnostic("error", "FORGE_MAKE_TABLE_EXISTS", `table '${tableName}' already exists`, file),
    );
    return { diagnostics };
  }

  const next = `${ensureSchemaImport(base).trimEnd()}\n\n${rendered}`;
  return {
    diagnostics,
    patch: {
      file,
      kind: existing ? "append-section" : "create-if-missing",
      description: `Add table '${tableName}'`,
      beforeHash: existing ? hashStable(existing) : undefined,
      afterPreview: next,
    },
  };
}

function fieldLine(field: MakeFieldSpec): string {
  const type =
    field.type === "enum"
      ? `enum:${field.enumValues?.join(",") ?? ""}`
      : field.type === "ref"
        ? `ref:${field.refTable ?? field.name.replace(/Id$/, "s")}`
        : field.type;
  return `    ${field.name}: "${type}",`;
}

function addFieldToSchema(
  workspaceRoot: string,
  tableName: string,
  field: MakeFieldSpec,
): { patch?: PlannedPatch; diagnostics: Diagnostic[] } {
  const file = chooseSchemaFile(workspaceRoot);
  const existing = readIfExists(workspaceRoot, file);
  const diagnostics: Diagnostic[] = [];
  if (!existing) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_MAKE_FILE_MISSING",
          `schema file '${file}' does not exist`,
          file,
        ),
      ],
    };
  }

  const tableExport = new RegExp(`export\\s+const\\s+${camelCase(tableName)}\\s*=\\s*defineTable`);
  const tableIndex = existing.search(tableExport);
  const nameIndex = existing.search(new RegExp(`name:\\s*["']${tableName}["']`));
  const start = tableIndex >= 0 ? tableIndex : nameIndex;
  if (start < 0) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_MAKE_COMMAND_TABLE_MISSING",
          `table '${tableName}' was not found in schema`,
          file,
        ),
      ],
    };
  }

  const fieldsIndex = existing.indexOf("fields: {", start);
  const closeIndex = fieldsIndex >= 0 ? existing.indexOf("\n  },", fieldsIndex) : -1;
  if (fieldsIndex < 0 || closeIndex < 0) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_MAKE_SCHEMA_UNSUPPORTED_SHAPE",
          `could not safely patch fields for table '${tableName}'`,
          file,
        ),
      ],
    };
  }

  const fieldsBlock = existing.slice(fieldsIndex, closeIndex);
  if (new RegExp(`\\b${field.name}\\s*:`).test(fieldsBlock)) {
    diagnostics.push(
      diagnostic(
        "error",
        "FORGE_MAKE_FIELD_EXISTS",
        `field '${field.name}' already exists on '${tableName}'`,
        file,
      ),
    );
    return { diagnostics };
  }

  const next = `${existing.slice(0, closeIndex)}\n${fieldLine(field)}${existing.slice(closeIndex)}`;
  return {
    diagnostics,
    patch: {
      file,
      kind: "replace-section",
      description: `Add field '${field.name}' to '${tableName}'`,
      beforeHash: hashStable(existing),
      afterPreview: next,
    },
  };
}

function parseRoles(raw: string | undefined): string[] {
  return (raw ?? "owner,admin,member")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean)
    .sort();
}

function buildPolicyContentFrom(
  file: string,
  existing: string | null,
  entries: Record<string, string[]>,
): { patch?: PlannedPatch; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const names = Object.keys(entries).sort();

  for (const name of names) {
    if (!/^[a-zA-Z0-9_.:-]+$/.test(name)) {
      diagnostics.push(
        diagnostic("error", "FORGE_MAKE_POLICY_NAME_INVALID", `invalid policy name '${name}'`, file),
      );
    }
    if ((entries[name] ?? []).length === 0) {
      diagnostics.push(
        diagnostic("error", "FORGE_MAKE_POLICY_EMPTY_ROLES", `policy '${name}' has no roles`, file),
      );
    }
    if (existing?.includes(`${JSON.stringify(name)}:`) || existing?.includes(`'${name}':`)) {
      diagnostics.push(
        diagnostic("error", "FORGE_MAKE_POLICY_EXISTS", `policy '${name}' already exists`, file),
      );
    }
  }
  if (diagnostics.length > 0) {
    return { diagnostics };
  }

  if (!existing) {
    return {
      diagnostics,
      patch: {
        file,
        kind: "create-if-missing",
        description: `Create policy file with ${names.length} policy entries`,
        afterPreview: renderPolicyFile(entries),
      },
    };
  }

  const closeIndex = existing.lastIndexOf("});");
  if (closeIndex < 0 || !existing.includes("definePolicies")) {
    return {
      diagnostics: [
        diagnostic(
          "error",
          "FORGE_MAKE_POLICY_UNSUPPORTED_SHAPE",
          `could not safely patch policy file '${file}'`,
          file,
        ),
      ],
    };
  }

  const additions = names
    .map(
      (name) =>
        `  ${JSON.stringify(name)}: canRole(${entries[name].map((role) => JSON.stringify(role)).join(", ")}),`,
    )
    .join("\n");
  const next = `${existing.slice(0, closeIndex).trimEnd()}\n${additions}\n${existing.slice(closeIndex)}`;
  return {
    diagnostics,
    patch: {
      file,
      kind: "append-section",
      description: `Add ${names.length} policy entries`,
      beforeHash: hashStable(existing),
      afterPreview: next,
    },
  };
}

function buildPolicyContent(
  workspaceRoot: string,
  entries: Record<string, string[]>,
): { patch?: PlannedPatch; diagnostics: Diagnostic[] } {
  const file = choosePolicyFile(workspaceRoot);
  return buildPolicyContentFrom(file, readIfExists(workspaceRoot, file), entries);
}

function createFile(
  workspaceRoot: string,
  file: string,
  description: string,
  content: string,
): PlannedFile {
  return {
    file,
    description,
    content,
    exists: fileExists(workspaceRoot, file),
  };
}

function defaultFields(kind: MakeIntent["kind"]): MakeFieldSpec[] {
  if (kind === "resource" || kind === "table") {
    return [
      { name: "title", type: "text", required: true, optional: false },
      {
        name: "status",
        type: "enum",
        required: true,
        optional: false,
        enumValues: ["open", "closed"],
        default: "open",
        indexed: true,
      },
    ];
  }
  return [];
}

function parseFieldOptions(options: MakeCommandOptions): {
  fields: MakeFieldSpec[];
  field?: MakeFieldSpec;
  diagnostics: Diagnostic[];
} {
  const rawFields = [
    ...(options.fieldsRaw ? [options.fieldsRaw] : []),
    ...options.fieldSpecs,
  ];
  const parsed = parseFields(rawFields);
  const diagnostics = [...parsed.diagnostics];

  if (options.primitive === "field") {
    const name = options.name?.includes(".")
      ? options.name.split(".").pop()
      : options.name;
    const type = options.type ?? "text";
    const rawType =
      type === "enum"
        ? `enum(${options.values ?? "open,closed"})`
        : type === "ref"
          ? `ref(${options.table ?? ""})`
          : type;
    const raw = [
      `${name ?? "field"}:${rawType}`,
      options.index ? "index" : "",
      options.defaultValue ? `default=${options.defaultValue}` : "",
    ]
      .filter(Boolean)
      .join(":");
    const field = parseFieldSpec(raw);
    diagnostics.push(...field.diagnostics);
    return { fields: parsed.fields, field: field.field, diagnostics };
  }

  return { fields: parsed.fields, diagnostics };
}

function defaultPolicyFor(tableName: string, action: string): string {
  return `${tableName}.${action}`;
}

function buildIntent(options: MakeCommandOptions): {
  intent?: MakeIntent;
  diagnostics: Diagnostic[];
} {
  if (!AUTHORING_PRIMITIVES.includes(options.primitive as MakeIntent["kind"])) {
    return {
      diagnostics: [
        diagnostic("error", "FORGE_MAKE_PATCH_UNSAFE", `unsupported make primitive '${options.primitive}'`),
      ],
    };
  }

  const kind = options.primitive as MakeIntent["kind"];
  const fieldOptions = parseFieldOptions(options);
  const diagnostics = [...fieldOptions.diagnostics];
  if (options.framework && !["vite", "next"].includes(options.framework)) {
    diagnostics.push(
      diagnostic("error", "FORGE_MAKE_PATCH_UNSAFE", `unsupported frontend framework '${options.framework}'`),
    );
  }
  if (kind === "ui" && options.framework === "next") {
    diagnostics.push(
      diagnostic(
        "warning",
        "FORGE_MAKE_UI_FRAMEWORK_EXPERIMENTAL",
        "forge make ui currently generates the Vite React bridge; Next support should use the b2b-support-web template",
      ),
    );
  }
  const name = options.name ?? (kind === "field" ? "" : undefined);
  if (!name && !["component", "page", "ui"].includes(kind)) {
    diagnostics.push(
      diagnostic("error", "FORGE_MAKE_PATCH_UNSAFE", `forge make ${kind} requires a name`),
    );
  }

  const tableFromName = name?.includes(".") ? name.split(".")[0] : undefined;
  const table = options.table ?? tableFromName ?? (kind === "resource" || kind === "table" ? name : undefined);
  const fields =
    fieldOptions.fields.length > 0 ? fieldOptions.fields : defaultFields(kind);
  const singular = singularize(table ?? name ?? "item");
  const actionName = name?.includes(".") ? name.split(".").pop() ?? name : name;
  const policyAction =
    kind === "command"
      ? actionName?.replace(/^(create|update|delete)/, "") || "create"
      : "read";

  return {
    diagnostics,
    intent: {
      kind,
      name: name ?? options.component ?? table ?? "component",
      table,
      field: fieldOptions.field,
      fields,
      tenantScoped: options.tenantScoped || kind === "resource",
      crud: options.withCrud || kind === "resource",
      liveQuery: options.withLiveQuery || kind === "resource" || kind === "livequery",
      react:
        options.withReact ||
        options.withUi ||
        kind === "resource" ||
        kind === "component" ||
        kind === "page" ||
        kind === "ui",
      tests: options.withTests || kind === "resource",
      policy:
        options.policy ??
        (table ? defaultPolicyFor(table, kind === "command" ? policyAction.toLowerCase() : "read") : undefined),
      roles: parseRoles(options.roles),
      emit: options.emit,
      event: options.event ?? options.emit ?? (table ? `${singular}.created` : undefined),
      trigger: options.trigger ?? options.event ?? (table ? `${singular}.created` : undefined),
      component: options.component,
      route: options.name ? kebabCase(options.name) : undefined,
      withAi: options.withAi,
      withCreateForm: options.withCreateForm || kind === "resource",
    },
  };
}

function addPatch(plan: MakePlan, result: { patch?: PlannedPatch; diagnostics: Diagnostic[] }): void {
  plan.diagnostics.push(...result.diagnostics);
  if (result.patch) {
    const existing = plan.filesToModify.find((patch) => patch.file === result.patch?.file);
    if (existing) {
      existing.afterPreview = result.patch.afterPreview;
      existing.description = `${existing.description}; ${result.patch.description}`;
      return;
    }
    plan.filesToModify.push(result.patch);
  }
}

function addPolicies(plan: MakePlan, workspaceRoot: string, entries: Record<string, string[]>): void {
  const existingPatch = plan.filesToModify.find((patch) => patch.file === choosePolicyFile(workspaceRoot));
  if (!existingPatch) {
    addPatch(plan, buildPolicyContent(workspaceRoot, entries));
    return;
  }

  const next = buildPolicyContentFrom(existingPatch.file, existingPatch.afterPreview, entries);
  if (next.patch) {
    existingPatch.afterPreview = next.patch.afterPreview;
    existingPatch.description = `${existingPatch.description}; ${next.patch.description}`;
  }
  plan.diagnostics.push(...next.diagnostics);
}

function addRuntimeFiles(plan: MakePlan, workspaceRoot: string, intent: MakeIntent): void {
  const table = intent.table ?? intent.name;
  const singular = singularize(table);
  const pascal = pascalCase(singular);
  const pascalPlural = pascalCase(table);
  const readPolicy = intent.policy ?? defaultPolicyFor(table, "read");
  const event = intent.event ?? `${singular}.created`;

  if (intent.kind === "command") {
    const action = intent.name.includes(".") ? intent.name.split(".").pop() ?? "create" : intent.name;
    const file = `src/commands/${camelCase(intent.name.replace(/\./g, "-"))}.ts`;
    const content =
      action.startsWith("update")
        ? renderUpdateCommand(table, intent.fields, intent.policy ?? defaultPolicyFor(table, "update"), intent.emit ?? `${singular}.updated`)
        : action.startsWith("delete")
          ? renderDeleteCommand(table, intent.policy ?? defaultPolicyFor(table, "delete"), intent.emit ?? `${singular}.deleted`)
          : renderCreateCommand(table, intent.fields, intent.policy ?? defaultPolicyFor(table, "create"), intent.emit ?? event);
    plan.filesToCreate.push(createFile(workspaceRoot, file, `Add command '${intent.name}'`, content));
    return;
  }

  if (intent.kind === "query") {
    const fileName = intent.name.includes("get") ? `get${pascal}` : `list${pascalPlural}`;
    const content = intent.name.includes("get")
      ? renderGetQuery(table, readPolicy)
      : renderListQuery(table, readPolicy);
    plan.filesToCreate.push(createFile(workspaceRoot, `src/queries/${fileName}.ts`, `Add query '${intent.name}'`, content));
    return;
  }

  if (intent.kind === "livequery") {
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `src/queries/live${pascalPlural}.ts`,
        `Add liveQuery '${intent.name}'`,
        renderLiveQuery(table, readPolicy),
      ),
    );
    return;
  }

  if (intent.kind === "action") {
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `src/actions/capture${pascal}Created.ts`,
        `Add action '${intent.name}'`,
        renderAction(table, intent.event ?? event),
      ),
    );
    return;
  }

  if (intent.kind === "workflow") {
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `src/workflows/${camelCase(intent.name)}.ts`,
        `Add workflow '${intent.name}'`,
        renderWorkflow(table, intent.trigger ?? event, intent.withAi),
      ),
    );
  }
}

function addFrontendFiles(plan: MakePlan, workspaceRoot: string, intent: MakeIntent): void {
  const table = intent.table ?? intent.name;
  const singular = singularize(table);
  const pascal = pascalCase(singular);
  if (intent.kind === "ui") {
    plan.filesToCreate.push(
      createFile(workspaceRoot, "web/package.json", "Add Vite React web package", renderVitePackage(intent.name)),
      createFile(workspaceRoot, "web/tsconfig.json", "Add web TypeScript config", renderViteTsconfig()),
      createFile(workspaceRoot, "web/index.html", "Add web HTML entry", renderViteIndex("ForgeOS App")),
      createFile(workspaceRoot, "web/src/lib/forge.ts", "Add Forge client bridge", renderWebBridge()),
      createFile(workspaceRoot, "web/src/main.tsx", "Add React entrypoint", renderViteMain()),
      createFile(workspaceRoot, "web/src/App.tsx", "Add starter app", renderViteApp()),
      createFile(workspaceRoot, "web/src/styles.css", "Add starter styles", renderViteStyles()),
    );
    return;
  }
  if (intent.kind === "component") {
    const component = intent.component ?? `${pascal}List`;
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `web/components/${component}.tsx`,
        `Add component '${component}'`,
        component.startsWith("Create")
          ? renderCreateForm(table, intent.fields)
          : renderListComponent(table),
      ),
    );
    return;
  }
  if (intent.kind === "page") {
    const route = intent.route ?? kebabCase(intent.name);
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `web/app/${route}/page.tsx`,
        `Add page '${route}'`,
        renderPage(table, intent.withCreateForm),
      ),
    );
    return;
  }

  if (intent.react) {
    if (!fileExists(workspaceRoot, "web/lib/forge.ts")) {
      plan.filesToCreate.push(
        createFile(
          workspaceRoot,
          "web/lib/forge.ts",
          "Add Forge client bridge",
          renderWebRootBridge(),
        ),
      );
    }
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `web/components/${pascal}List.tsx`,
        `Add ${titleCase(table)} list component`,
        renderListComponent(table),
      ),
    );
    if (intent.withCreateForm) {
      plan.filesToCreate.push(
        createFile(
          workspaceRoot,
          `web/components/Create${pascal}Form.tsx`,
          `Add ${titleCase(table)} create form`,
          renderCreateForm(table, intent.fields),
        ),
      );
    }
    plan.filesToCreate.push(
      createFile(
        workspaceRoot,
        `web/app/${kebabCase(table)}/page.tsx`,
        `Add ${titleCase(table)} page`,
        renderPage(table, intent.withCreateForm),
      ),
    );
  }
}

function buildPlan(options: MakeCommandOptions): MakePlan {
  const built = buildIntent(options);
  const intent = built.intent ?? {
    kind: "resource" as const,
    name: options.name ?? "resource",
    fields: [],
    tenantScoped: true,
    crud: true,
    liveQuery: true,
    react: true,
    tests: true,
    roles: [],
    withAi: false,
    withCreateForm: true,
  };
  const id = `make_${hashStable(canonicalJson(intent)).slice(0, 12)}`;
  const plan: MakePlan = {
    schemaVersion: "0.1.0",
    makeVersion: GENERATOR_VERSION,
    id,
    intent,
    summary: `Plan forge make ${intent.kind} ${intent.name}`,
    filesToCreate: [],
    filesToModify: [],
    filesToDelete: [],
    generatedAfterApply: !options.noGenerate,
    commandsToRun: [
      ...(!options.noGenerate ? ["forge generate"] : []),
      ...(!options.noVerify ? ["forge verify --strict"] : []),
    ],
    diagnostics: [...built.diagnostics],
    risk: { level: "low", reasons: [] },
    rollback: {
      trackedFiles: [],
      instructions: [`forge make rollback ${id}`],
    },
  };

  const table = intent.table ?? intent.name;
  if (intent.kind === "table" || intent.kind === "resource") {
    addPatch(plan, appendSchemaTable(options.workspaceRoot, table, intent.fields, intent.tenantScoped));
    if (intent.tenantScoped) {
      const schema = readIfExists(options.workspaceRoot, chooseSchemaFile(options.workspaceRoot)) ?? "";
      if (!schema.includes('name: "tenants"') && !schema.includes("name: 'tenants'")) {
        plan.diagnostics.push(
          diagnostic(
            "warning",
            "FORGE_MAKE_TENANTS_TABLE_MISSING",
            "tenant-scoped table references tenants but no tenants table was found",
            chooseSchemaFile(options.workspaceRoot),
          ),
        );
      }
    }
  }

  if (intent.kind === "field" && intent.field) {
    const targetTable = intent.table ?? intent.name.split(".")[0];
    addPatch(plan, addFieldToSchema(options.workspaceRoot, targetTable, intent.field));
  }

  if (intent.kind === "policy") {
    addPolicies(plan, options.workspaceRoot, { [intent.name]: intent.roles });
  }

  if (intent.kind === "resource") {
    addPolicies(plan, options.workspaceRoot, {
      [defaultPolicyFor(table, "create")]: intent.roles,
      [defaultPolicyFor(table, "delete")]: intent.roles.filter((role) => role !== "member"),
      [defaultPolicyFor(table, "read")]: intent.roles,
      [defaultPolicyFor(table, "update")]: intent.roles,
    });
    plan.filesToCreate.push(
      createFile(
        options.workspaceRoot,
        `src/commands/create${pascalCase(singularize(table))}.ts`,
        `Add create command for '${table}'`,
        renderCreateCommand(table, intent.fields, defaultPolicyFor(table, "create"), `${singularize(table)}.created`),
      ),
      createFile(
        options.workspaceRoot,
        `src/commands/update${pascalCase(singularize(table))}.ts`,
        `Add update command for '${table}'`,
        renderUpdateCommand(table, intent.fields, defaultPolicyFor(table, "update"), `${singularize(table)}.updated`),
      ),
      createFile(
        options.workspaceRoot,
        `src/commands/delete${pascalCase(singularize(table))}.ts`,
        `Add delete command for '${table}'`,
        renderDeleteCommand(table, defaultPolicyFor(table, "delete"), `${singularize(table)}.deleted`),
      ),
      createFile(
        options.workspaceRoot,
        `src/queries/list${pascalCase(table)}.ts`,
        `Add list query for '${table}'`,
        renderListQuery(table, defaultPolicyFor(table, "read")),
      ),
      createFile(
        options.workspaceRoot,
        `src/queries/get${pascalCase(singularize(table))}.ts`,
        `Add get query for '${table}'`,
        renderGetQuery(table, defaultPolicyFor(table, "read")),
      ),
    );
    if (intent.liveQuery) {
      plan.filesToCreate.push(
        createFile(
          options.workspaceRoot,
          `src/queries/live${pascalCase(table)}.ts`,
          `Add liveQuery for '${table}'`,
          renderLiveQuery(table, defaultPolicyFor(table, "read")),
        ),
      );
    }
    plan.filesToCreate.push(
      createFile(
        options.workspaceRoot,
        `src/actions/capture${pascalCase(singularize(table))}Created.ts`,
        `Add created action for '${table}'`,
        renderAction(table, `${singularize(table)}.created`),
      ),
    );
  }

  if (["command", "query", "livequery", "action", "workflow"].includes(intent.kind)) {
    addRuntimeFiles(plan, options.workspaceRoot, intent);
  }

  if (["component", "page"].includes(intent.kind) || intent.react) {
    addFrontendFiles(plan, options.workspaceRoot, intent);
  }

  if (intent.tests) {
    plan.filesToCreate.push(
      createFile(
        options.workspaceRoot,
        `tests/make-generated/${kebabCase(intent.name)}.test.ts`,
        `Add smoke test for '${intent.name}'`,
        renderPlaceholderTest(`forge make ${intent.kind} ${intent.name}`),
      ),
    );
  }

  for (const file of plan.filesToCreate) {
    if (file.exists && !options.force) {
      plan.diagnostics.push(
        diagnostic("error", "FORGE_MAKE_FILE_EXISTS", `file already exists: ${file.file}`, file.file),
      );
    }
  }

  const schemaOrPolicy = plan.filesToModify.length > 0;
  if (schemaOrPolicy) {
    plan.risk.level = plan.diagnostics.some((diag) => diag.severity === "error") ? "high" : "medium";
    plan.risk.reasons.push("schema or policy source changes require regeneration");
  }
  if (plan.filesToCreate.length > 5) {
    plan.risk.reasons.push("resource generation creates multiple runtime files");
  }
  plan.rollback.trackedFiles = [
    ...plan.filesToCreate.map((file) => file.file),
    ...plan.filesToModify.map((patch) => patch.file),
  ].sort();

  return plan;
}

function planPath(_workspaceRoot: string, planId: string): string {
  return `${PLAN_DIR}/${planId}/plan.json`;
}

function snapshotPath(_workspaceRoot: string, planId: string): string {
  return `${PLAN_DIR}/${planId}/snapshot.json`;
}

function writePlanFiles(workspaceRoot: string, plan: MakePlan): string {
  const dir = `${PLAN_DIR}/${plan.id}`;
  const jsonPath = `${dir}/plan.json`;
  writeText(workspaceRoot, jsonPath, serializeCanonical(plan));
  writeText(
    workspaceRoot,
    `${dir}/plan.md`,
    `# ${plan.summary}\n\nFiles to create:\n${plan.filesToCreate.map((file) => `- ${file.file}`).join("\n") || "- none"}\n\nFiles to modify:\n${plan.filesToModify.map((file) => `- ${file.file}`).join("\n") || "- none"}\n`,
  );
  return normalizeRel(jsonPath);
}

function readPlan(workspaceRoot: string, idOrPath: string): MakePlan | null {
  const candidates = [
    idOrPath,
    planPath(workspaceRoot, idOrPath),
    `${PLAN_DIR}/${idOrPath}/plan.json`,
  ];
  for (const candidate of candidates) {
    const content = readIfExists(workspaceRoot, candidate);
    if (content) {
      return JSON.parse(content) as MakePlan;
    }
  }
  return null;
}

function writeSnapshot(workspaceRoot: string, plan: MakePlan): void {
  const seen = new Set<string>();
  const files: SnapshotFile[] = [];
  for (const file of plan.rollback.trackedFiles) {
    if (seen.has(file)) {
      continue;
    }
    seen.add(file);
    const content = readIfExists(workspaceRoot, file);
    files.push({
      file,
      existed: content !== null,
      ...(content !== null ? { content } : {}),
    });
  }
  const snapshot: MakeSnapshot = {
    schemaVersion: "0.1.0",
    planId: plan.id,
    files,
  };
  writeText(workspaceRoot, snapshotPath(workspaceRoot, plan.id), serializeCanonical(snapshot));
}

function applyPlan(workspaceRoot: string, plan: MakePlan, force: boolean): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  writeSnapshot(workspaceRoot, plan);

  for (const file of plan.filesToCreate) {
    const exists = fileExists(workspaceRoot, file.file);
    if (exists && !force) {
      diagnostics.push(
        diagnostic("error", "FORGE_MAKE_FILE_EXISTS", `file already exists: ${file.file}`, file.file),
      );
      continue;
    }
    writeText(workspaceRoot, file.file, file.content);
  }

  for (const patch of plan.filesToModify) {
    if (patch.beforeHash) {
      const current = readIfExists(workspaceRoot, patch.file);
      if (current !== null && hashStable(current) !== patch.beforeHash) {
        diagnostics.push(
          diagnostic(
            "error",
            "FORGE_MAKE_PATCH_UNSAFE",
            `file changed after plan was created: ${patch.file}`,
            patch.file,
          ),
        );
        continue;
      }
    }
    writeText(workspaceRoot, patch.file, patch.afterPreview);
  }

  return diagnostics;
}

export function rollbackMakePlan(workspaceRoot: string, idOrPath: string): MakeResult {
  const id = idOrPath.endsWith(".json") ? dirname(idOrPath).split(/[\\/]/).pop() ?? idOrPath : idOrPath;
  const snapshotRaw = readIfExists(workspaceRoot, snapshotPath(workspaceRoot, id));
  if (!snapshotRaw) {
    return failResult([
      diagnostic("error", "FORGE_MAKE_FILE_MISSING", `missing make snapshot for '${id}'`),
    ]);
  }
  const snapshot = JSON.parse(snapshotRaw) as MakeSnapshot;
  for (const file of snapshot.files) {
    if (file.existed) {
      writeText(workspaceRoot, file.file, file.content ?? "");
    } else {
      removeFile(workspaceRoot, file.file);
    }
  }
  return okResult({ applied: true, explanation: `rolled back ${snapshot.planId}` });
}

export function planMakeCommand(options: MakeCommandOptions): MakeResult {
  if (options.primitive === "list") {
    return okResult({ primitives: MAKE_PRIMITIVES });
  }

  if (options.primitive === "explain") {
    const primitive = options.explainPrimitive as MakeIntent["kind"] | undefined;
    if (!primitive || !(primitive in EXPLANATIONS)) {
      return failResult([
        diagnostic("error", "FORGE_MAKE_PATCH_UNSAFE", "forge make explain requires a known primitive"),
      ]);
    }
    return okResult({ explanation: EXPLANATIONS[primitive] });
  }

  if (options.primitive === "rollback") {
    return rollbackMakePlan(options.workspaceRoot, options.name ?? "");
  }

  if (options.primitive === "apply") {
    const plan = options.name ? readPlan(options.workspaceRoot, options.name) : null;
    if (!plan) {
      return failResult([
        diagnostic("error", "FORGE_MAKE_FILE_MISSING", `make plan not found: ${options.name ?? ""}`),
      ]);
    }
    const diagnostics = applyPlan(options.workspaceRoot, plan, options.force);
    return {
      ok: diagnostics.filter((diag) => diag.severity === "error").length === 0,
      plan,
      applied: diagnostics.filter((diag) => diag.severity === "error").length === 0,
      diagnostics,
      exitCode: diagnostics.some((diag) => diag.severity === "error") ? 1 : 0,
    };
  }

  const plan = buildPlan(options);
  const errors = plan.diagnostics.filter((diag) => diag.severity === "error");
  const planPathWritten = options.plan ? writePlanFiles(options.workspaceRoot, plan) : undefined;

  if (errors.length > 0) {
    return failResult(plan.diagnostics, plan);
  }

  if (options.dryRun || !options.apply) {
    return {
      ok: true,
      plan,
      planPath: planPathWritten,
      diagnostics: plan.diagnostics,
      exitCode: 0,
    };
  }

  const applyDiagnostics = applyPlan(options.workspaceRoot, plan, options.force);
  const diagnostics = [...plan.diagnostics, ...applyDiagnostics];
  const ok = !diagnostics.some((diag) => diag.severity === "error");
  return {
    ok,
    plan,
    applied: ok,
    planPath: planPathWritten,
    diagnostics,
    exitCode: ok ? 0 : 1,
  };
}

export function parseMakeFields(raw: string | undefined): string[] {
  return raw ? splitTopLevel(raw) : [];
}
