// @forge-generated generator=0.1.0-alpha.63 input=593f2e9e12f4e6d0c8846dbd6c98a5de6b0813032749fe5c8264cf5fb791acb0 content=f64ed237a464321c0b04236ca0f6eba798e18892ac6eb30f02fbaac1bcedb1e7
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
