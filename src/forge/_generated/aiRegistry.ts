// @forge-generated generator=0.0.0 input=c993235bac641e26d1c764366c2f0bc976f1395f3160be4d219c0f6e6817cb42 content=bfe454cd1e5b217ae60bcec490aa980e850a2cd676a15ad4d5baba20d78410d3
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "d5b7dec9f3a2c5dbb3aeef40a4010883da37a5a808f1aaedd612ea48090d4fff",
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
