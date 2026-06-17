// @forge-generated generator=0.1.0-alpha.8 input=7e9241d38232a56e5930612085bbc6719ac771f9c0cd3f836ab721e9b76abb1d content=27a3fd362b85da0ebaf11345ce74bd252a9699ef453087fbf9ec48f7a7a7e11a
export const secretRegistry = {
  "secrets": [
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-gateway",
      "name": "AI_GATEWAY_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-provider-anthropic",
      "name": "ANTHROPIC_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "allowedContexts": [
        "server",
        "action",
        "workflow",
        "endpoint",
        "test",
        "build"
      ],
      "integration": "ai-provider-openai",
      "name": "OPENAI_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    }
  ]
} as const;
