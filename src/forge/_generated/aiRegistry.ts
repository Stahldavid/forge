// @forge-generated generator=0.1.0-alpha.15 input=624aeb38a3511aee123d146b3484fd077c65e0c6548f1bd50890c71ee0c207ae content=ce9c8c9610b1dbce9d16b5d1c23e06dacd5be745f4a37db50338f34fff03b3e3
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.15",
  "inputHash": "255f98e7d4702ec6dbcd1a6fdfc460457c0dbc8763bf88e6072c4c9e07505233",
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
