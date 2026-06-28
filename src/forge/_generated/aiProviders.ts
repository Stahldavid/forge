// @forge-generated generator=0.1.0-alpha.37 input=3c5b62bbf7ebf4e3965eda693951a98a2455bbf63bd241c83c730a8f4b260b86 content=f64ed237a464321c0b04236ca0f6eba798e18892ac6eb30f02fbaac1bcedb1e7
export const aiProviders = {
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
  ]
} as const;
