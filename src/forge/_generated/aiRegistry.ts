// @forge-generated generator=0.0.0 input=4c29ce2e8b8d2562ab263e34db7d7d40557d80f6e2ef6a9712fe7bab4b0e04dc content=c7dc34a33f7de89ab18b9f67503b36752d141c8a480f54a361cbbfd5cad15b80
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "9f2025a8437a3caead304b756d3fa655f83b618a92805523522ea8f6856aed0a",
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
