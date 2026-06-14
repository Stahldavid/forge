// @forge-generated generator=0.0.0 input=892c076b902f6a9986304095ff389c9c0914f58520887962a99025b48031349d content=c89ee22fffa8147602420485e3a54abad9a8f0e79ffec3623b3711f99c9e91cd
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "39519a4b65d6bfaaf49f2fe7b9d4e85ebed46c347c61e91cd9b2cd7599ea0dc0",
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
