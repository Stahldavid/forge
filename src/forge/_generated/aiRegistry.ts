// @forge-generated generator=0.0.0 input=bb5d0f225b6751ee6b500f8b46cfaa2b4674b5e3697378a505d47e65d797ba83 content=df85199290e23e7575a66a01f42363ca7c63014342123cd7bd89081a58170f40
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "8134c31a1d1ce23cf9410b3b997182a601a547f440069fb26328faa7b2cefd9d",
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
