import { fieldTypeForSchema } from "./fields.ts";
import {
  camelCase,
  kebabCase,
  pascalCase,
  singularize,
  titleCase,
} from "./naming.ts";
import type { MakeFieldSpec } from "./types.ts";

function inputFields(fields: MakeFieldSpec[]): MakeFieldSpec[] {
  return fields.filter(
    (field) =>
      !["id", "tenantId", "createdAt", "updatedAt"].includes(field.name) &&
      field.default === undefined &&
      !field.defaultNow,
  );
}

function typeForTs(field: MakeFieldSpec): string {
  if (field.type === "number" || field.type === "integer") {
    return "number";
  }
  if (field.type === "boolean") {
    return "boolean";
  }
  if (field.type === "json") {
    return "unknown";
  }
  if (field.type === "enum") {
    return (field.enumValues ?? []).map((value) => JSON.stringify(value)).join(" | ") || "string";
  }
  return "string";
}

function inputType(fields: MakeFieldSpec[]): string {
  const entries = inputFields(fields);
  if (entries.length === 0) {
    return "Record<string, never>";
  }
  return `{ ${entries.map((field) => `${field.name}${field.optional ? "?" : ""}: ${typeForTs(field)}`).join("; ")} }`;
}

function insertObject(fields: MakeFieldSpec[]): string {
  const lines: string[] = [];
  for (const field of fields) {
    if (["id", "tenantId", "createdAt", "updatedAt"].includes(field.name)) {
      continue;
    }
    if (field.default !== undefined) {
      lines.push(`      ${field.name}: ${JSON.stringify(field.default)},`);
    } else if (field.defaultNow) {
      continue;
    } else {
      lines.push(`      ${field.name}: input.${field.name},`);
    }
  }
  return lines.join("\n");
}

export function renderSchemaTable(
  tableName: string,
  fields: MakeFieldSpec[],
  tenantScoped: boolean,
): string {
  const fieldLines = [
    `    id: "uuid",`,
    ...(tenantScoped ? [`    tenantId: "ref:tenants",`] : []),
    ...fields.map((field) => `    ${field.name}: "${fieldTypeForSchema(field)}",`),
    `    createdAt: "timestamp",`,
    `    updatedAt: "timestamp",`,
  ];

  return `export const ${camelCase(tableName)} = defineTable({
  name: ${JSON.stringify(tableName)},
  fields: {
${fieldLines.join("\n")}
  },
});
`;
}

export function renderPolicyFile(policies: Record<string, string[]>): string {
  const entries = Object.entries(policies)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([name, roles]) =>
        `  ${JSON.stringify(name)}: canRole(${roles.map((role) => JSON.stringify(role)).join(", ")}),`,
    );
  return `import { canRole, definePolicies } from "forge/server";

export const policies = definePolicies({
${entries.join("\n")}
});
`;
}

export function renderCreateCommand(tableName: string, fields: MakeFieldSpec[], policy: string, event: string): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  const fn = `create${pascal}`;
  return `import { can, command } from "forge/server";

export const ${fn} = command({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx, input: ${inputType(fields)}) => {
    const ${camelCase(singular)} = await ctx.db.${camelCase(tableName)}.insert({
${insertObject(fields)}
    });

    await ctx.emit(${JSON.stringify(event)}, {
      ${camelCase(singular)}Id: ${camelCase(singular)}.id,
    });

    await ctx.telemetry.capture(${JSON.stringify(`${camelCase(singular)}_created`)}, {
      ${camelCase(singular)}Id: ${camelCase(singular)}.id,
    });

    return ${camelCase(singular)};
  },
});
`;
}

export function renderUpdateCommand(tableName: string, fields: MakeFieldSpec[], policy: string, event: string): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  const args = inputFields(fields).map((field) => `${field.name}?: ${typeForTs(field)}`);
  return `import { can, command } from "forge/server";

export const update${pascal} = command({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx, input: { id: string; ${args.join("; ")} }) => {
    const patch = Object.fromEntries(
      Object.entries(input).filter(([key, value]) => key !== "id" && value !== undefined),
    );
    const ${camelCase(singular)} = await ctx.db.${camelCase(tableName)}.update(input.id, patch);

    await ctx.emit(${JSON.stringify(event)}, {
      ${camelCase(singular)}Id: input.id,
    });

    return ${camelCase(singular)};
  },
});
`;
}

export function renderDeleteCommand(tableName: string, policy: string, event: string): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  return `import { can, command } from "forge/server";

export const delete${pascal} = command({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx, input: { id: string }) => {
    const deleted = await ctx.db.${camelCase(tableName)}.delete(input.id);

    if (deleted) {
      await ctx.emit(${JSON.stringify(event)}, {
        ${camelCase(singular)}Id: input.id,
      });
    }

    return { deleted };
  },
});
`;
}

export function renderListQuery(tableName: string, policy: string): string {
  const pascal = pascalCase(tableName);
  return `import { can, query } from "forge/server";

export const list${pascal} = query({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx) => {
    return ctx.db.${camelCase(tableName)}.all();
  },
});
`;
}

export function renderGetQuery(tableName: string, policy: string): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  return `import { can, query } from "forge/server";

export const get${pascal} = query({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx, input: { id: string }) => {
    return ctx.db.${camelCase(tableName)}.get(input.id);
  },
});
`;
}

export function renderLiveQuery(tableName: string, policy: string): string {
  const pascal = pascalCase(tableName);
  return `import { can, liveQuery } from "forge/server";

export const live${pascal} = liveQuery({
  auth: can(${JSON.stringify(policy)}),

  handler: async (ctx) => {
    return ctx.db.${camelCase(tableName)}.all();
  },
});
`;
}

export function renderAction(tableName: string, event: string): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  return `import { action } from "forge/server";

export const capture${pascal}Created = action({
  event: ${JSON.stringify(event)},

  handler: async (ctx, event: { ${camelCase(singular)}Id: string }) => {
    await ctx.telemetry.capture(${JSON.stringify(`${camelCase(singular)}_created_action_processed`)}, {
      ${camelCase(singular)}Id: event.${camelCase(singular)}Id,
    });

    return { captured: true };
  },
});
`;
}

export function renderWorkflow(tableName: string, trigger: string, withAi: boolean): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  const camel = camelCase(singular);
  const aiStep = withAi
    ? `
    step("classify${pascal}", async (ctx, run) => {
      const result = await ctx.ai.generateText({
        provider: "openai",
        model: "mock",
        prompt: \`Classify ${singular}: \${run.input.${camel}Id}\`,
        purpose: ${JSON.stringify(`${camel}_workflow`)},
      });
      return { classification: result.text, usage: result.usage };
    }),
`
    : "";
  return `import { event, step, workflow } from "forge/server";

export const ${camel}Workflow = workflow({
  trigger: event(${JSON.stringify(trigger)}),

  steps: [
    step("load${pascal}", async (ctx, run) => {
      const ${camel} = await ctx.db.${camelCase(tableName)}.get(run.input.${camel}Id);
      return { ${camel} };
    }),${aiStep}
    step("captureTelemetry", async (ctx, run) => {
      await ctx.telemetry.capture(${JSON.stringify(`${camel}_workflow_completed`)}, {
        ${camel}Id: run.input.${camel}Id,
      });
      return { captured: true };
    }),
  ],
});
`;
}

export function renderListComponent(tableName: string): string {
  const pascalPlural = pascalCase(tableName);
  const component = `${pascalCase(singularize(tableName))}List`;
  return `"use client";

import { api } from "../../src/forge/_generated/api";
import { useLiveQuery } from "../../src/forge/_generated/react";

export function ${component}() {
  const ${camelCase(tableName)} = useLiveQuery(api.liveQueries.live${pascalPlural}, {});

  if (${camelCase(tableName)}.loading) {
    return <p>Loading ${tableName}...</p>;
  }

  if (${camelCase(tableName)}.error) {
    return <p>{${camelCase(tableName)}.error.code}</p>;
  }

  return (
    <ul>
      {${camelCase(tableName)}.data?.map((item) => (
        <li key={item.id}>{item.id}</li>
      ))}
    </ul>
  );
}
`;
}

export function renderCreateForm(tableName: string, fields: MakeFieldSpec[]): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  const field = inputFields(fields)[0];
  const firstField = field?.name ?? "title";
  return `"use client";

import { api } from "../../src/forge/_generated/api";
import { useCommand } from "../../src/forge/_generated/react";

export function Create${pascal}Form() {
  const create${pascal} = useCommand(api.commands.create${pascal});

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void create${pascal}.run({
          ${firstField}: String(form.get(${JSON.stringify(firstField)}) ?? ""),
        });
      }}
    >
      <input name=${JSON.stringify(firstField)} />
      <button type="submit">Create</button>
    </form>
  );
}
`;
}

export function renderPage(tableName: string, withCreateForm: boolean): string {
  const singular = singularize(tableName);
  const pascal = pascalCase(singular);
  const title = titleCase(tableName);
  return `"use client";

import { ${pascal}List } from "../../components/${pascal}List";
${withCreateForm ? `import { Create${pascal}Form } from "../../components/Create${pascal}Form";` : ""}

export default function ${pascal}Page() {
  return (
    <main>
      <h1>${title}</h1>
      ${withCreateForm ? `<Create${pascal}Form />` : ""}
      <${pascal}List />
    </main>
  );
}
`;
}

export function renderPlaceholderTest(name: string): string {
  return `import { describe, expect, test } from "bun:test";

describe(${JSON.stringify(name)}, () => {
  test("generated source is present", () => {
    expect(true).toBe(true);
  });
});
`;
}

export { kebabCase };
