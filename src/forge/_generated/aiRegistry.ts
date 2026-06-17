// @forge-generated generator=0.1.0-alpha.8 input=3fb619bf835f25bb4ff97aa048ec14e2b5079a13c310f91d21f362a0ba16ae7d content=934549fd029800465a90894996872cbad5241731931cbb02bb0e3e4e8b5b91ef
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.8",
  "inputHash": "bb8cc8d5ac75dce8d2558ce811fe0ca9738948ea9913115fca9a2c81c1b5f2c9",
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
  "schemaVersion": "1",
  "tools": []
} as const;
