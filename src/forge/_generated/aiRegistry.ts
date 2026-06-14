// @forge-generated generator=0.0.0 input=9e880b62d68467971301bf49dffafff1e2d3349e057b63a56714a305fffd61d2 content=e50a117bb40aca78803ce36c1993cb67418ea002eb043cf5e16d7b7098ad215f
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "8f3e26556048998b248a17493bc1d150f5a955c77e2a3b7d6930d2743b5706af",
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
