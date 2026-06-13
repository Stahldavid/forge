// @forge-generated generator=0.0.0 input=ab3d21aea9e96108a34a31e3b7ae28f8b477be08f5be2e5004d81283cbeeedc4 content=0b211bdf5c9557931aaf6117cb6410c69cda1d879218602e17594af8ed11e5c6
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "b522d0d4d9a57b241a9e24fd8b5a5030bc121c219b65172cec8bfa9185dea65f",
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
