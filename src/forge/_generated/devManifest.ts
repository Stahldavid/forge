// @forge-generated generator=0.1.0-alpha.0 input=bbcb5249a5456591d9d88ee11d0e1be99fc6bd72fc1bd3e65550c8656da372cf content=9b9bc3ecda4bdec5a00a1c6c764f12566e70db41a2f8c4835e75257bd13890fd
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.0",
  "inputHash": "022247e4cecb58440faa3d4b0922f268ba9e698c6455d4f9eae48fa07638fa5a",
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
