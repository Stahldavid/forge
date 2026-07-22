// @forge-generated generator=0.1.0-alpha.63 input=43623ccc7209d544f8745a8d03de2c1703d186ea75709a2ca79af821a88f2818 content=414a858d4002a44bafebcee73cf499b6fee0b8c0fcf5aa7c70cf887170e36f81
export const aiRegistry = {
  "agents": [],
  "analyzerVersion": "1.1.0",
  "diagnostics": [],
  "generations": [
    {
      "file": "src/forge/cli/ai.ts",
      "method": "generateText",
      "model": "unknown",
      "provider": "openai",
      "purpose": "cli_test"
    },
    {
      "file": "src/forge/cli/ai.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai",
      "purpose": "agent_model_redteam"
    },
    {
      "file": "src/forge/dev/server.ts",
      "method": "generateText",
      "model": "unknown",
      "provider": "openai",
      "purpose": "dev_test"
    },
    {
      "file": "src/forge/dev/server.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai"
    },
    {
      "file": "src/forge/runtime/context/create-context.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai"
    }
  ],
  "generatorVersion": "0.1.0-alpha.63",
  "inputHash": "1b414bd6e0308b0c3b9bafb9b949142c21a97df09a9786186fa36f2af6147b10",
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
