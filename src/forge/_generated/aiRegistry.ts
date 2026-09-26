// @forge-generated generator=0.1.0-alpha.63 input=128a75a60a7187f4b372ac9ffdd8c42ca3f2eac7281400dd5418fce8108ea630 content=f31938ef70031255af2bf04171b3627b785ea71d1a670d434de4dbb8358d9901
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
  "inputHash": "3eefb402b6815ee45f1e3d19a95603ca67364bcb4b263c4ce9f9a888ddb20021",
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
