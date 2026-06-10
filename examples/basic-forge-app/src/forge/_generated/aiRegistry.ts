// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=4371f8827167e7c15e0f3f3b0d6f39a1cb352c68236de2332f114d6942343104
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [
    {
      "file": "src/workflows/triageTicketWorkflow.ts",
      "method": "generateText",
      "model": "gpt-4o-mini",
      "provider": "openai",
      "purpose": "ticket_triage"
    }
  ],
  "generatorVersion": "0.0.0",
  "inputHash": "9fd30c0bf90c6d93ecbef410e861aa6362de0361f3eda6a1a41f79b7bb0a9990",
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
  ],
  "schemaVersion": "1"
} as const;
