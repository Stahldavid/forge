// @forge-generated generator=0.1.0-alpha.2 input=58a72e10cb9647fa0d43ab28ebda1633d68b0cad8579c6a19686b78b101febbd content=f64ed237a464321c0b04236ca0f6eba798e18892ac6eb30f02fbaac1bcedb1e7
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
