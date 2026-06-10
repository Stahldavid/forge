// @forge-generated generator=0.0.0 input=3dca8512d9791aca68400cfc59bb3ddc0654faa8040d530afba050fc105a74dc content=e380162db96e93f43d95e442d6a46d6433b02b262e31416138eba37b1f5b0f4e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "9cb562a48482cc91ea733c03b224779369e7160e028fc7c48f3a7edcc355ed20",
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
