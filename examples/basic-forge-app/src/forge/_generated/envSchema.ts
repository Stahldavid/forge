// @forge-generated generator=0.0.0 input=9255ba138ae80878f8ea821fed168d05fd040cb5d5f09ec1dae92c86cfbdf974 content=05bbcea077461ede699c362052883108bfcd4bf34d8b7bd0323e30555b8e426a
export const envSchema = {
  "variables": [
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
