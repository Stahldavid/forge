// @forge-generated generator=0.1.0-alpha.9 input=ca868c8ec6ee8cac0b8a654cbdfef0cc44cdb8d68fa7e924cc6237ac0241a710 content=829ca607b9d4dcf079aeb3933bb2928e548ca065cfbea85eee2ea56ad13d40aa
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.1.0-alpha.9",
  "inputHash": "2ede05d09165f6df68afe86c7e25e37a1e5b305644770f57a97a4dbe51b92bae",
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
