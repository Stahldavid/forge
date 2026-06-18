// @forge-generated generator=0.1.0-alpha.14 input=d960fc3e75c3f21b1066e18eba126fb8d7b18633f82417cd61779fc88366e1e8 content=f1b07d00dab53771e83e843e44ff0bba13794f9029fae573692b8864ea54271c
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.14",
  "inputHash": "c52dbf089dbb7ebeaee1f7763b2b914605fbdd8ee493e92149ae09998f43871a",
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
