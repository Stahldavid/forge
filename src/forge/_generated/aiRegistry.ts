// @forge-generated generator=0.0.0 input=4ae63b4e9e2e74aa8e076675d3e853b39126fb575d3f7c1c5eccba7ff37cd07a content=117a22f72d2bd8841bcbb4653292e190320005822476601cd84f0dfdbc7ea91a
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "61743ee79a6d5470a223f07f0affbe94aa40ce038a55d913309b2f8d72ffd374",
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
