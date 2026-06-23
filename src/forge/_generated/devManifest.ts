// @forge-generated generator=0.1.0-alpha.18 input=0ee1bf2f038128efd72c20246ad0f70215b2e3ba0bf04eba957f20f4cdeea9cc content=bbf13ba8ece05f6d547488ec955939b035f7e6784faad3ba72e1f330d89da9c2
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.18",
  "inputHash": "cc57931820c8149f2a60ff8a635c4929257587a9c69a1739f8e4b963c43c1de2",
  "routes": [
    {
      "method": "GET",
      "path": "/",
      "purpose": "home"
    },
    {
      "method": "POST",
      "path": "/ai/agents/chat",
      "purpose": "ai-agent-chat"
    },
    {
      "method": "POST",
      "path": "/ai/agents/run",
      "purpose": "ai-agent-run"
    },
    {
      "method": "GET",
      "path": "/ai/providers",
      "purpose": "ai-providers"
    },
    {
      "method": "GET",
      "path": "/entries",
      "purpose": "entries"
    },
    {
      "method": "GET",
      "path": "/health",
      "purpose": "health"
    },
    {
      "method": "GET",
      "path": "/queries",
      "purpose": "queries"
    },
    {
      "method": "GET",
      "path": "/workflows",
      "purpose": "workflows"
    },
    {
      "method": "POST",
      "path": "/workflows/process",
      "purpose": "workflow-process"
    },
    {
      "method": "GET",
      "path": "/workflows/runs",
      "purpose": "workflow-runs"
    }
  ],
  "schemaVersion": "1.0.0",
  "workflows": []
} as const;
