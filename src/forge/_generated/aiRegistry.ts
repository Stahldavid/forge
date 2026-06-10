// @forge-generated generator=0.0.0 input=481ffa610c5cbb0ef8370ed7373686bc25fa51098fa75f82e48d114759c58c90 content=09383debdc83bbb5c5e84be63fdba5d852002663a94628fe28a6b9e1a9f6c8f4
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "dce1298ec8a091e13c007f5e74b1cc9a9095484acfe462d79abb7a4664a9dc4f",
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
