// @forge-generated generator=0.1.0-alpha.39 input=f8919744f953e216381deb3344bfadd99210164d5b86a1ecfa27c2e44825c874 content=27a3fd362b85da0ebaf11345ce74bd252a9699ef453087fbf9ec48f7a7a7e11a
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
