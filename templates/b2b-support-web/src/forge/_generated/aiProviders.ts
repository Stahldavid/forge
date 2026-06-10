// @forge-generated generator=0.0.0 input=be0a4129920f48c42d269789fd5c26029f4132e224b712db2471797b6371dc78 content=5fbd3ece153781ce5b3d8e5fb8f752abaf8f5af9bc712241150a94f1888c3c49
export const aiProviders = {
  "providers": [
    {
      "id": "openai",
      "integration": "ai-provider-openai",
      "packageName": "@ai-sdk/openai",
      "secretName": "OPENAI_API_KEY"
    },
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
    }
  ]
} as const;
