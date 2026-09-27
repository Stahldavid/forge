// @forge-generated generator=0.1.0-alpha.63 input=3ba530f8432c93912c3e9b02ed9be6c6365dad9216f0a63d0c0a517cb06d4665 content=dac7bcbdb4dfff91eed4fe0226d4856d0c9c79d2e7bc74facd78fc4adc8cee35
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
  "inputHash": "e8e7491962e13c63d1111b25dd431a5e7526331d7b6c8606ba05031405bff560",
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
