// @forge-generated generator=0.1.0-alpha.9 input=7e1d521593b626abf25a35531d4a4d31d541cae45c515610751b15e073c4d5a7 content=7a86c7f70c5440fd1b3ff2b4e6ec7dc0dc8609bede92179aa642247b882e175c
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.9",
  "inputHash": "031a71284339ce5e5095fea908ce0074fccfd1f07a03e33414385666717303f8",
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
