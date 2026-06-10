// @forge-generated generator=0.0.0 input=54f3f6b66f87a575bff2d09c80de50b1bfca193d6bbbd7adb6204ec0df01c245 content=a585cf1f80016a8bae077f95e3746cd2fcac184903c1802ca4f32f53eb2925d5
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
  "inputHash": "58f25e4388fa53b2cf9b9b5dbb46d0f406c62b5b085155d7d42d1a10f8057ae9",
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
