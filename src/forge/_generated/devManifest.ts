// @forge-generated generator=0.1.0-alpha.0 input=3e73eacf20870a5978a8aeb9088112fa211eecaef5a80a7e51b92cbd8b40cd8d content=4e9887d5ebbda540bf0e2a16664cb50e30a881e4ca31b1d75faeb7ef061cf1a1
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.0",
  "inputHash": "445bd2671e07183eecdce66aa9ed1b24ab94fd7c50c2f9f3098ad3bbaa683aa0",
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
