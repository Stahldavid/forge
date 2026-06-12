// @forge-generated generator=0.0.0 input=2190d56a1db1355810806f497ad3a2e68f900245ae47a7cdc651f0cd2c949f50 content=bff08fe0cd5581ee19033e8749e026ca8caa682ee9afff3f0afae62f3e18383f
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.0.0",
  "inputHash": "6f2a9c1519816e0f393cff476086b051baf2a753e527eefb0e27144acb5b1a2a",
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
