// @forge-generated generator=0.1.0-alpha.23 input=eec97c876c38e3c86c16e6a488b4abbd0d9253406b5e3a492f6674a134d0d950 content=96e186c7d4d25366e23f312f5404ba3a812dc2701d35ee3f849cc1be8a9fcc18
export const makeRegistry = {
  "commands": [
    "forge make list --json",
    "forge make explain <primitive> --json",
    "forge make ui --framework vite --dry-run --json",
    "forge make ui --framework nuxt --dry-run --json",
    "forge make ai-chat support --dry-run --json",
    "forge make resource <name> --fields title:text,status:enum(open,closed) --dry-run --json",
    "forge make resource <name> --fields title:text --with-ui --yes",
    "forge make apply <planId>",
    "forge make rollback <planId>"
  ],
  "generatorVersion": "0.1.0-alpha.23",
  "planDirectory": ".forge/make-plans",
  "primitives": [
    {
      "creates": [],
      "examples": [
        "forge make table invoices --fields amount:number,status:text"
      ],
      "modifies": [
        "src/forge/schema.ts"
      ],
      "name": "table",
      "summary": "Add a schema table declaration."
    },
    {
      "creates": [],
      "examples": [
        "forge make field invoices.status --type enum --values draft,paid"
      ],
      "modifies": [
        "src/forge/schema.ts"
      ],
      "name": "field",
      "summary": "Add a field to an existing table declaration."
    },
    {
      "creates": [
        "src/policies.ts when missing"
      ],
      "examples": [
        "forge make policy invoices.read --roles owner,admin,member"
      ],
      "modifies": [
        "src/policies.ts"
      ],
      "name": "policy",
      "summary": "Add a named policy with allowed roles."
    },
    {
      "creates": [
        "src/commands/<name>.ts"
      ],
      "examples": [
        "forge make command invoices.create --table invoices --policy invoices.create --emit invoice.created"
      ],
      "modifies": [],
      "name": "command",
      "summary": "Add a transactional command with policy and optional event emission."
    },
    {
      "creates": [
        "src/queries/<name>.ts"
      ],
      "examples": [
        "forge make query invoices.list --table invoices --policy invoices.read"
      ],
      "modifies": [],
      "name": "query",
      "summary": "Add a read-only query."
    },
    {
      "creates": [
        "src/queries/live<Name>.ts"
      ],
      "examples": [
        "forge make livequery invoices.live --table invoices --policy invoices.read"
      ],
      "modifies": [],
      "name": "livequery",
      "summary": "Add a read-only liveQuery for reactive clients."
    },
    {
      "creates": [
        "src/actions/<name>.ts"
      ],
      "examples": [
        "forge make action captureInvoiceCreated --event invoice.created"
      ],
      "modifies": [],
      "name": "action",
      "summary": "Add an after-commit action subscribed to an event."
    },
    {
      "creates": [
        "src/workflows/<name>.ts"
      ],
      "examples": [
        "forge make workflow invoiceWorkflow --table invoices --trigger invoice.created"
      ],
      "modifies": [],
      "name": "workflow",
      "summary": "Add a durable workflow triggered by an event."
    },
    {
      "creates": [
        "web/components/<Component>.tsx"
      ],
      "examples": [
        "forge make component InvoiceList --table invoices"
      ],
      "modifies": [],
      "name": "component",
      "summary": "Add a React component that uses generated Forge client hooks."
    },
    {
      "creates": [
        "web/app/<route>/page.tsx"
      ],
      "examples": [
        "forge make page invoices --table invoices --with-create-form"
      ],
      "modifies": [],
      "name": "page",
      "summary": "Add a minimal app page wired to generated components."
    },
    {
      "creates": [
        "web/package.json",
        "web/src/lib/forge.ts or web/composables/forge.ts",
        "web/src/main.tsx or web/app.vue"
      ],
      "examples": [
        "forge make ui --framework vite --yes",
        "forge make ui --framework nuxt --yes"
      ],
      "modifies": [],
      "name": "ui",
      "summary": "Add a Vite React or Nuxt Vue frontend shell with generated Forge client bindings."
    },
    {
      "creates": [
        "src/ai/<name>Agent.ts",
        "web/components/<Name>AiChat.tsx",
        "web/app/<name>-ai/page.tsx when web/app exists"
      ],
      "examples": [
        "forge make ai-chat support --yes"
      ],
      "modifies": [],
      "name": "ai-chat",
      "summary": "Add a Forge AI agent and React chat component backed by /ai/agents/run."
    },
    {
      "creates": [
        "src/commands/*",
        "src/queries/*",
        "src/actions/*",
        "web/components/*",
        "web/app/*",
        "tests/make-generated/*"
      ],
      "examples": [
        "forge make resource invoices --fields amount:number,status:enum(draft,paid) --with-ui --yes"
      ],
      "modifies": [
        "src/forge/schema.ts",
        "src/policies.ts"
      ],
      "name": "resource",
      "summary": "Add schema, policies, CRUD, queries, liveQuery, optional UI, and tests."
    }
  ],
  "schemaVersion": "0.1.0"
} as const;
