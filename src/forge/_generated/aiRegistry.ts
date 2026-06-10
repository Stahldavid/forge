// @forge-generated generator=0.0.0 input=73411733ee4b2adeaa331f0cdfd5f207efa0f149c37c2770aee30c1b71a96c1b content=2f7f941483c91816c8b97a1c537d91f32fdd58f455b544279270a6fb0617a754
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "8969630773021c83136888c18282b152083c572d9fd54dc6318c03734f746ccb",
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
