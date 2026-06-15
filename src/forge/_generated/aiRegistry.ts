// @forge-generated generator=0.1.0-alpha.1 input=15db5211b2295feba64a25a14ce8d07c783b9685e9994859941a0139d6f10d5d content=40331894ad261ecca049e04fd0ef394d79be45e4e983f03f8213949701ad7b0c
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.1",
  "inputHash": "0437998804f1dc0cc5250eccd878f8d2d50c484e707426fe2a1a714e8d3c2b01",
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
