// @forge-generated generator=0.0.0 input=546500a6b3678160b7670bd4f0428cd9913860cf4a90429c9bd9563aa38bc60f content=41284c8bae02191e47cfb572e51d54a38d403792687efc32897c0a316d02df33
export const envSchema = {
  "variables": [
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
      "integration": "posthog",
      "kind": "config",
      "name": "NEXT_PUBLIC_POSTHOG_KEY",
      "public": true,
      "required": true,
      "source": "recipe"
    },
    {
      "integration": "posthog",
      "kind": "secret",
      "name": "POSTHOG_HOST",
      "public": false,
      "required": false,
      "source": "recipe"
    },
    {
      "integration": "posthog",
      "kind": "secret",
      "name": "POSTHOG_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "integration": "stripe",
      "kind": "secret",
      "name": "STRIPE_SECRET_KEY",
      "public": false,
      "required": true,
      "source": "recipe"
    },
    {
      "integration": "stripe",
      "kind": "secret",
      "name": "STRIPE_WEBHOOK_SECRET",
      "public": false,
      "required": true,
      "source": "recipe"
    }
  ]
} as const;
