// @forge-generated generator=0.0.0 input=e3aac12cf3579fdd72c83a62dc7bfccf02deb235f7b566a6afffb37f538b1de1 content=b34067be1c901fcbdd008040a31cf45593d2b3eefaa576502101c501218d227d
export const aiRegistry = {
  "analyzerVersion": "1.0.0",
  "diagnostics": [],
  "generations": [],
  "generatorVersion": "0.0.0",
  "inputHash": "ed1381ea99c0f26220ac6311b728b4412a71a49bef2fc03d4dd699d513f43c44",
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
  "schemaVersion": "1"
} as const;
