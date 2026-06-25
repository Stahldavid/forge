// @forge-generated generator=0.1.0-alpha.24 input=39a7799ce0d6a71823dac10eaa13053e61eb77cb610a1245f2ea90d381769517 content=914e2b41972769af5fe51a24402486985ca050e207ec2e15ff246ccd200cdaf1
export const devManifest = {
  "analyzerVersion": "0.1.0",
  "diagnostics": [],
  "entries": [],
  "generatorVersion": "0.1.0-alpha.24",
  "inputHash": "e1cb35579868139090492bb7b6ee62ff26aa24dd3ecec1dd0e05a50454009a92",
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
