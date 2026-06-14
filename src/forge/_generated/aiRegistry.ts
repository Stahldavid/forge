// @forge-generated generator=0.0.0 input=04cda99540127c1abd021a6fdf9e70496bc1a73a5be0b0993f754cb4b8a808de content=44757aa7b9d1a7c7f376ecd7d9980e6670731cabbd9f43e52b20064ca69a25b9
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "6a470c59baf0a590a8a49120a6f45eaea9075dc03a61df1059c1b7c276645dc3",
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
