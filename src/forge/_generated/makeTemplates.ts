// @forge-generated generator=0.1.0-alpha.2 input=f450ec7161e279f2460d497d4129943c5786d075c3be87365a6f1f0ab77a3fcd content=bec3e76f4a2feb0f6a1f4e3fb74d038a13ce13c7da0796fe16f4567ca0594f6e
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
      "name": "placeholder-test",
      "outputPattern": "tests/make-generated/<name>.test.ts",
      "sourceKind": "test"
    }
  ]
} as const;
