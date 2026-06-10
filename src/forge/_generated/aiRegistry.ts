// @forge-generated generator=0.0.0 input=6b7aee4a8b6c6948b038e96c5f9e8ce00867dd83453b7db1b9e5076d6b834c9f content=68848450a25544cc0f122ec51f2407be9bd6b7f1c4e01995cfc0e3aca46c8e1e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "7d260b945346b0f5b8075c9755a9f56018359446d201aad62c4f91640493c2cb",
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
