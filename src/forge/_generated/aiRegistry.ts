// @forge-generated generator=0.1.0-alpha.18 input=708af382008551e1ec0972158bf7ba0ad9cb4c4c4a7356fc75bbc51cd0719fa5 content=658eacefde252986d4a71f1123138311ef1b8b2d51686e92d8955904545c4686
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
      "file": "src/forge/compiler/integration/templates/ai.ts",
      "method": "generateStructured",
      "model": "unknown",
      "provider": "openai"
    },
    {
      "file": "src/forge/compiler/integration/templates/ai.ts",
      "method": "generateText",
      "model": "unknown",
      "provider": "openai"
    },
    {
      "file": "src/forge/compiler/integration/templates/ai.ts",
      "method": "streamText",
      "model": "unknown",
      "provider": "openai"
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
      "file": "src/forge/make/templates.ts",
      "method": "generateText",
      "model": "mock",
      "provider": "openai"
    },
    {
      "file": "src/forge/runtime/context/create-context.ts",
      "method": "runAgent",
      "model": "unknown",
      "provider": "openai"
    }
  ],
  "generatorVersion": "0.1.0-alpha.18",
  "inputHash": "ed9e2ced97656ea12779d933a134c512f4d54f88ac80f221c6459e8469e6f62f",
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
