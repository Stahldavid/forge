// @forge-generated generator=0.0.0 input=4ae63b4e9e2e74aa8e076675d3e853b39126fb575d3f7c1c5eccba7ff37cd07a content=c80f4ba0f4066c0409c70b1854a4b9f125db0509b5bc1f4073fc53105b33d292
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.0.0",
  "inputHash": "f9359e4308423d080a1c8ff773eb16d46d19e9e31831715c41b13b28fb84dfd3",
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
