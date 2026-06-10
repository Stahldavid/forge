// @forge-generated generator=0.0.0 input=d4c04bb50918289504020c384505fe134421a7b93d98da721b1dc7d12103c611 content=3bbb07ef4c7b99e8cc1cc765caf767138180d7899ad38da15457a73109bbaa09
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "method": "generateText",
      "model": "gpt-4o-mini",
      "provider": "openai",
      "purpose": "ticket_triage"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "c424029689c38706271114f36cec0590e80057326f40e37513913a5780853c66",
  "providers": [
    {
      "id": "openai",
      "integration": "ai-provider-openai",
      "packageName": "@ai-sdk/openai",
      "secretName": "OPENAI_API_KEY"
    },
    {
      "id": "anthropic",
      "integration": "ai-provider-anthropic",
      "packageName": "@ai-sdk/anthropic",
      "secretName": "ANTHROPIC_API_KEY"
    },
    {
      "id": "gateway",
      "integration": "ai-gateway",
      "packageName": "ai",
      "secretName": "AI_GATEWAY_API_KEY"
    }
  ],
  "schemaVersion": "1"
} as const;
