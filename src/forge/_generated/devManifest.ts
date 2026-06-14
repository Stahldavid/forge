// @forge-generated generator=0.0.0 input=63458738bac974b4ff03fe48d3571992372cc65a0787a44e6a9445b5f60dd213 content=e97f55ec518d2745c9b7bb50442225c782b5a55a2991ed9a3ae4cc5d0a03845e
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.0.0",
  "inputHash": "a6c2371b3040024e2ea6b8f8e5c97d2408d5e9a0947f55760420a445cd27fb12",
  "routes": [
    {
      "method": "GET",
      "path": "/",
      "purpose": "home"
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
