// @forge-generated generator=0.1.0-alpha.0 input=91d8894f322b8dd604714d7b26a8bac3b5bbb0904d62cc0e2761ba21098e1537 content=248849b5fcfc9339e246087f63de9f8044d036a6e0d5f862b39c787d4dd7b98e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.0",
  "inputHash": "ccf18bbeddb19756ef979d6da1ec811535c04211fba4bf2b7663cf33fb65de8c",
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
  "schemaVersion": "1"
} as const;
