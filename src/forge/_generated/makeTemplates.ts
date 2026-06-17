// @forge-generated generator=0.1.0-alpha.10 input=0027e0819b107e3a91d36a3ebe496b8d70dd5bdf64c0d3399d8cc69acef3d5e3 content=d77484c9887220010cac51e14aaa010154cd261244eea7bf22a2aaaedca6afb4
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
      "outputPattern": "web/src/App.tsx",
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
