// @forge-generated generator=0.1.0-alpha.0 input=2bec5acb1fae59bf9d55eca4937af5b76424e610905e4ef337a33d3f7ec220d2 content=bec3e76f4a2feb0f6a1f4e3fb74d038a13ce13c7da0796fe16f4567ca0594f6e
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
