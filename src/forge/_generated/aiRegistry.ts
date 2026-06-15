// @forge-generated generator=0.1.0-alpha.2 input=f450ec7161e279f2460d497d4129943c5786d075c3be87365a6f1f0ab77a3fcd content=036f858f5c3aca2b740b6ac895719a785e4b303e74414537720b936e1a773574
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.2",
  "inputHash": "9641b6c26f8b19800e142c7eb883d47f89291c0f5afb9e38db4e63e0048dd686",
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
