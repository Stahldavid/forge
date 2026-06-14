// @forge-generated generator=0.0.0 input=294cdbf416a632080779f7447122c428a01aac52320533ad709082ab546848c7 content=0ea3fda16d3259016110fc55eb5015a6f696a1e89dab9dca1779d10334f98366
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "4cae98306386b3ffd5a7bd7a2c29c36b4c1d5e71cb5479488d9540fb056f82b4",
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
