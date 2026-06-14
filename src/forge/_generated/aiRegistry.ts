// @forge-generated generator=0.0.0 input=c66c98a8c537973af073e7571f522683b815b3f5adafa2cc9a3135b370a91b9e content=96329b85d184db7b79b4decd82c4fad6bbf450dff356d1f5c677f6076c35e31f
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "27b4cdc73191ab350ed256c18b9b5941850db5a9f59dcf5eb48826e3ef0d95a2",
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
