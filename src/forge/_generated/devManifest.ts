// @forge-generated generator=0.1.0-alpha.72 input=a9884755157b13634a2b69e255d6418f0092af011d647161d0cfff332ffbbe63 content=44b39367785ff00aedc408794edf4ac99878eca9b348ce5a6ac3e209c33f6106
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [
    {
      "invokePath": "/run/__forge_15_32",
      "kind": "action",
      "name": "__forge_15_32",
      "semanticPath": "/actions/__forge_15_32"
    }
  ],
  "generatorVersion": "0.1.0-alpha.72",
  "inputHash": "6fcf93cb62417e26b8d1b87f1c8a38ac768439533a13965abd6dec0eaa919c6f",
  "routes": [
    {
      "method": "GET",
      "path": "/",
      "purpose": "home"
    },
    {
      "entryKind": "action",
      "entryName": "__forge_15_32",
      "method": "POST",
      "path": "/actions/__forge_15_32",
      "purpose": "invoke"
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
      "entryKind": "action",
      "entryName": "__forge_15_32",
      "method": "POST",
      "path": "/run/__forge_15_32",
      "purpose": "invoke"
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
