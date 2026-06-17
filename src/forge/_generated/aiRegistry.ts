// @forge-generated generator=0.1.0-alpha.9 input=11d52fee585f53d8e2be9d455295ba3ac5ff6b218e315ec8a27fc58cfdefcb5f content=890faa69cfa6c85dc15326d3d745348bc2cc7769fc187d66847f14710bd2a468
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.9",
  "inputHash": "5873fe042c16c00c84f3126361e6241d96f373f78ffe029760a7eef791567795",
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
