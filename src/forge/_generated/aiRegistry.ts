// @forge-generated generator=0.0.0 input=3debe8250f2a55e0435ff17460670b7124ff352649ae964a2504f457192e5fa9 content=3484a601c37fb8aceeef60a5d4361fb3a373791933171dd4b98ce8ade6c8972d
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "e493bdacaa80047571c9d59a777a90883c9002316ef820cd5f00f0ecd5c6b734",
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
