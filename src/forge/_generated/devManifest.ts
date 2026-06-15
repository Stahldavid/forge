// @forge-generated generator=0.1.0-alpha.2 input=53ebe776c36da97cc5e1cdd3412de67fa665c6640a49fb8f7c76c8a09ab92af6 content=2942c506a8a56aee9d6e9b97750b82004e4478ea2f9b1755e14baa3ef6819c33
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.2",
  "inputHash": "40c3f4fed0607afc5336ba86042d08d98714a1f6a44e806fe2da313f04b0f1c9",
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
