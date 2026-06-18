import { serializeCanonical } from "../primitives/serialize.ts";

export interface MakePrimitiveInfo {
  name: string;
  summary: string;
  creates: string[];
  modifies: string[];
  examples: string[];
}

export interface MakeRegistryArtifact {
  schemaVersion: "0.1.0";
  generatorVersion: string;
  primitives: MakePrimitiveInfo[];
  planDirectory: ".forge/make-plans";
  commands: string[];
}

export interface MakeTemplateArtifact {
  schemaVersion: "0.1.0";
  templates: Array<{
    name: string;
    sourceKind: "schema" | "policy" | "runtime" | "frontend" | "test";
    outputPattern: string;
  }>;
}

export function buildMakeRegistry(generatorVersion: string): MakeRegistryArtifact {
  return {
    schemaVersion: "0.1.0",
    generatorVersion,
    planDirectory: ".forge/make-plans",
    commands: [
      "forge make list --json",
      "forge make explain <primitive> --json",
      "forge make ui --framework vite --dry-run --json",
      "forge make ui --framework nuxt --dry-run --json",
      "forge make ai-chat support --dry-run --json",
      "forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json",
      "forge make resource <name> --fields title:text --with-ui --yes",
      "forge make apply <planId>",
      "forge make rollback <planId>",
    ],
    primitives: [
      {
        name: "table",
        summary: "Add a schema table declaration.",
        creates: [],
        modifies: ["src/forge/schema.ts"],
        examples: ["forge make table invoices --fields amount:number,status:text"],
      },
      {
        name: "field",
        summary: "Add a field to an existing table declaration.",
        creates: [],
        modifies: ["src/forge/schema.ts"],
        examples: ["forge make field invoices.status --type enum --values draft,paid"],
      },
      {
        name: "policy",
        summary: "Add a named policy with allowed roles.",
        creates: ["src/policies.ts when missing"],
        modifies: ["src/policies.ts"],
        examples: ["forge make policy invoices.read --roles owner,admin,member"],
      },
      {
        name: "command",
        summary: "Add a transactional command with policy and optional event emission.",
        creates: ["src/commands/<name>.ts"],
        modifies: [],
        examples: ["forge make command invoices.create --table invoices --policy invoices.create --emit invoice.created"],
      },
      {
        name: "query",
        summary: "Add a read-only query.",
        creates: ["src/queries/<name>.ts"],
        modifies: [],
        examples: ["forge make query invoices.list --table invoices --policy invoices.read"],
      },
      {
        name: "livequery",
        summary: "Add a read-only liveQuery for reactive clients.",
        creates: ["src/queries/live<Name>.ts"],
        modifies: [],
        examples: ["forge make livequery invoices.live --table invoices --policy invoices.read"],
      },
      {
        name: "action",
        summary: "Add an after-commit action subscribed to an event.",
        creates: ["src/actions/<name>.ts"],
        modifies: [],
        examples: ["forge make action captureInvoiceCreated --event invoice.created"],
      },
      {
        name: "workflow",
        summary: "Add a durable workflow triggered by an event.",
        creates: ["src/workflows/<name>.ts"],
        modifies: [],
        examples: ["forge make workflow invoiceWorkflow --table invoices --trigger invoice.created"],
      },
      {
        name: "component",
        summary: "Add a React component that uses generated Forge client hooks.",
        creates: ["web/components/<Component>.tsx"],
        modifies: [],
        examples: ["forge make component InvoiceList --table invoices"],
      },
      {
        name: "page",
        summary: "Add a minimal app page wired to generated components.",
        creates: ["web/app/<route>/page.tsx"],
        modifies: [],
        examples: ["forge make page invoices --table invoices --with-create-form"],
      },
      {
        name: "ui",
        summary: "Add a Vite React or Nuxt Vue frontend shell with generated Forge client bindings.",
        creates: [
          "web/package.json",
          "web/src/lib/forge.ts or web/composables/forge.ts",
          "web/src/main.tsx or web/app.vue",
        ],
        modifies: [],
        examples: ["forge make ui --framework vite --yes", "forge make ui --framework nuxt --yes"],
      },
      {
        name: "ai-chat",
        summary: "Add a Forge AI agent and React chat component backed by /ai/agents/run.",
        creates: [
          "src/ai/<name>Agent.ts",
          "web/components/<Name>AiChat.tsx",
          "web/app/<name>-ai/page.tsx when web/app exists",
        ],
        modifies: [],
        examples: ["forge make ai-chat support --yes"],
      },
      {
        name: "resource",
        summary: "Add schema, policies, CRUD, queries, liveQuery, optional UI, and tests.",
        creates: [
          "src/commands/*",
          "src/queries/*",
          "src/actions/*",
          "web/components/*",
          "web/app/*",
          "tests/make-generated/*",
        ],
        modifies: ["src/forge/schema.ts", "src/policies.ts"],
        examples: ["forge make resource invoices --fields amount:number,status:enum(draft,paid) --with-ui --yes"],
      },
    ],
  };
}

export function buildMakeTemplates(): MakeTemplateArtifact {
  return {
    schemaVersion: "0.1.0",
    templates: [
      { name: "schema-table", sourceKind: "schema", outputPattern: "src/forge/schema.ts" },
      { name: "policy", sourceKind: "policy", outputPattern: "src/policies.ts" },
      { name: "command", sourceKind: "runtime", outputPattern: "src/commands/<name>.ts" },
      { name: "query", sourceKind: "runtime", outputPattern: "src/queries/<name>.ts" },
      { name: "livequery", sourceKind: "runtime", outputPattern: "src/queries/live<Name>.ts" },
      { name: "action", sourceKind: "runtime", outputPattern: "src/actions/<name>.ts" },
      { name: "workflow", sourceKind: "runtime", outputPattern: "src/workflows/<name>.ts" },
      { name: "component", sourceKind: "frontend", outputPattern: "web/components/<name>.tsx" },
      { name: "page", sourceKind: "frontend", outputPattern: "web/app/<route>/page.tsx" },
      { name: "ui", sourceKind: "frontend", outputPattern: "web/src/App.tsx or web/app.vue" },
      { name: "ai-chat", sourceKind: "frontend", outputPattern: "web/components/<name>AiChat.tsx" },
      { name: "placeholder-test", sourceKind: "test", outputPattern: "tests/make-generated/<name>.test.ts" },
    ],
  };
}

export function serializeMakeRegistryJson(registry: MakeRegistryArtifact): string {
  return serializeCanonical(registry);
}

export function serializeMakeRegistryTs(registry: MakeRegistryArtifact): string {
  const parsed: unknown = JSON.parse(serializeMakeRegistryJson(registry).trimEnd());
  return `export const makeRegistry = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}

export function serializeMakeTemplatesJson(templates: MakeTemplateArtifact): string {
  return serializeCanonical(templates);
}

export function serializeMakeTemplatesTs(templates: MakeTemplateArtifact): string {
  const parsed: unknown = JSON.parse(serializeMakeTemplatesJson(templates).trimEnd());
  return `export const makeTemplates = ${JSON.stringify(parsed, null, 2)} as const;\n`;
}
