// @forge-generated generator=0.1.0-alpha.3 input=d49018f43da5bba5ad177ba70e680f500a3aaba2062aa8f597ee4332662c0305 content=1c4f2af933ae8bcb0be60d498fbcb035be3db463b7868b3b0bda2793e5053484
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.3",
  "inputHash": "81a37187cb88a61b291ec689e73741ffe7ab875a9daa5582860006a73b1f2017",
  "providers": [
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
    },
    {
      "id": "openai",
      "integration": "ai-provider-openai",
      "packageName": "@ai-sdk/openai",
      "secretName": "OPENAI_API_KEY"
    }
  ],
  "schemaVersion": "1",
  "tools": []
} as const;
