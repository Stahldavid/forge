// @forge-generated generator=0.1.0-alpha.13 input=4014caa977eff4a37c3ff6c255f595e2ae9f80b25fb6970482fd60ba5a7cf3b6 content=ed6acb1912324d4cc84d8d6ba49bcde313aa469b55b71b592c5ec6614c5b193a
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.13",
  "inputHash": "b78e2518fde58dfdd41b14cc19c40c6cdda8e665f4245f39daf0465797987c1c",
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
