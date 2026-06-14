// @forge-generated generator=0.0.0 input=acc89dd0bc51861863664d88778845a6bd9d8e826b8df13c550857dc5015407f content=391aa0896442514bdc1a0103161628cdc8395682fa795cc6d67566c732dfeb4e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "fcedbfba90bcd562e3fd0b625d6686fb8df0e84b6c8c12475f2775b8b6bc0bef",
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
