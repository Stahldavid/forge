// @forge-generated generator=0.1.0-alpha.11 input=d1e9ea1b1e7d1268b74c027b8d605e187a9ea56cbbb5aeff174833ed68610c4c content=500fcc1b059c3c194da0e24cecc4f7979f36a3098e75279ef72b26eb5b05e221
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.11",
  "inputHash": "fbfc9ce93de16112d983bc08612ff58e1974d1858d148b65e4376d92fca71fb1",
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
