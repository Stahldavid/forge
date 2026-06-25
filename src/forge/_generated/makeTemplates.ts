// @forge-generated generator=0.1.0-alpha.24 input=39a7799ce0d6a71823dac10eaa13053e61eb77cb610a1245f2ea90d381769517 content=5239d21f9c87bfad8b8ab8128df724fa0ea0030add19884c47d4f9fbb16a7cb0
export const makeTemplates = {
  "schemaVersion": "0.1.0",
  "templates": [
    {
      "name": "schema-table",
      "outputPattern": "src/forge/schema.ts",
      "sourceKind": "schema"
    },
    {
      "name": "policy",
      "outputPattern": "src/policies.ts",
      "sourceKind": "policy"
    },
    {
      "name": "command",
      "outputPattern": "src/commands/<name>.ts",
      "sourceKind": "runtime"
    },
    {
      "name": "query",
      "outputPattern": "src/queries/<name>.ts",
      "sourceKind": "runtime"
    },
    {
      "name": "livequery",
      "outputPattern": "src/queries/live<Name>.ts",
      "sourceKind": "runtime"
    },
    {
      "name": "action",
      "outputPattern": "src/actions/<name>.ts",
      "sourceKind": "runtime"
    },
    {
      "name": "workflow",
      "outputPattern": "src/workflows/<name>.ts",
      "sourceKind": "runtime"
    },
    {
      "name": "component",
      "outputPattern": "web/components/<name>.tsx",
      "sourceKind": "frontend"
    },
    {
      "name": "page",
      "outputPattern": "web/app/<route>/page.tsx",
      "sourceKind": "frontend"
    },
    {
      "name": "ui",
      "outputPattern": "web/src/App.tsx or web/app.vue",
      "sourceKind": "frontend"
    },
    {
      "name": "ai-chat",
      "outputPattern": "web/components/<name>AiChat.tsx",
      "sourceKind": "frontend"
    },
    {
      "name": "placeholder-test",
      "outputPattern": "tests/make-generated/<name>.test.ts",
      "sourceKind": "test"
    }
  ]
} as const;
