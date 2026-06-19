// @forge-generated generator=0.1.0-alpha.17 input=e751b452338c88a7e9e015c5a6bcc9dfb7a7a36386e730af0ddf5e86dca23232 content=01b9581854d81492e15aa554826459b7ff6b4636bba4d183345f9d915a525398
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.17",
  "inputHash": "47f40ba006e93b6e3a5e7a58f0f81b34472f186750844aee6fec10835bab03f4",
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
