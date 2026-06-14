// @forge-generated generator=0.0.0 input=73f6857f8307f1ab2a66f6d2d4b5eb6643ce6b342bc66ae7469f0837fa4195c0 content=f090db7d7002d75cf2410db92170face5635034bdc4fd08eeab400d6c0aac3a7
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.0.0",
  "inputHash": "fbcaed739c9dd8eaf72bfdbb41c852bba8dfe80df910c96398303d2cb71bf189",
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
