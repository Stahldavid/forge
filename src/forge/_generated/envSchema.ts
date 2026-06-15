// @forge-generated generator=0.1.0-alpha.0 input=2bec5acb1fae59bf9d55eca4937af5b76424e610905e4ef337a33d3f7ec220d2 content=a3d1351f5a64cfe2964d5140049c55de5620e2abfb8187bbb244990852cfbbef
export const envSchema = {
  "variables": [
    {
      "integration": "ai-gateway",
      "kind": "secret",
      "name": "AI_GATEWAY_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "integration": "ai-provider-anthropic",
      "kind": "secret",
      "name": "ANTHROPIC_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "kind": "config",
      "name": "FORGE_AUTH_ALGORITHMS",
      "required": false,
      "source": "auth"
    },
    {
      "kind": "config",
      "name": "FORGE_AUTH_AUDIENCE",
      "required": false,
      "source": "auth"
    },
    {
      "kind": "config",
      "name": "FORGE_AUTH_ISSUER",
      "required": false,
      "source": "auth"
    },
    {
      "kind": "config",
      "name": "FORGE_AUTH_JWKS_URI",
      "required": false,
      "source": "auth"
    },
    {
      "kind": "config",
      "name": "FORGE_AUTH_MODE",
      "required": false,
      "source": "auth"
    },
    {
      "integration": "ai-provider-openai",
      "kind": "secret",
      "name": "OPENAI_API_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    }
  ]
} as const;
