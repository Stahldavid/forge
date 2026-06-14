// @forge-generated generator=0.0.0 input=63458738bac974b4ff03fe48d3571992372cc65a0787a44e6a9445b5f60dd213 content=b8f83da62ce7d6b5824fb58b8cd283d65b2b9f64d579fe70812a2be9343e5c3e
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "e2f19cce98bb908e74efb5219ccbf83003eb7eade69d284f1464bb1314850d99",
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
