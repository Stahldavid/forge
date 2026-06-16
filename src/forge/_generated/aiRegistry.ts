// @forge-generated generator=0.1.0-alpha.5 input=622ec288588000a575ed155ad05aeada86dd21a51fa5d04404453dd81ada8886 content=ee33c0cd79ab46f25b8a0c5e9639ef4f634624584eea31fffc66bcf60a53690e
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.5",
  "inputHash": "31e04d78106969177d2330f734506d84c890541bc578afabdacc2e64af87d9cc",
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
