// @forge-generated generator=0.1.0-alpha.26 input=778efcf6ab1654d740a63150785427347e3b87d5b7720acc9f26a9e512e0e5fa content=f64ed237a464321c0b04236ca0f6eba798e18892ac6eb30f02fbaac1bcedb1e7
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
