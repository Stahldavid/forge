import type { CapabilitySet } from "../types/capability.ts";
import type { IntegrationRecipe } from "../types/integration.ts";
import type { RuntimeContext } from "../types/runtime.ts";
import { capability, emptyCapabilitySet, secret } from "./helpers.ts";

export const RECIPE_SCHEMA_VERSION = "1";

const SERVER_CONTEXTS: RuntimeContext[] = [
  "server",
  "action",
  "workflow",
  "endpoint",
];

const CLIENT_CONTEXTS: RuntimeContext[] = ["client"];

const ALL_CONTEXTS: RuntimeContext[] = [
  "shared",
  "client",
  "server",
  "query",
  "liveQuery",
  "command",
  "action",
  "workflow",
  "endpoint",
  "edge",
  "test",
  "build",
];

function networkCapability(
  egress: string[],
  evidence: string[],
): CapabilitySet {
  const base = emptyCapabilitySet();
  return {
    ...base,
    network: capability("required", "manual", evidence, { egress }),
  };
}

export const STRIPE_RECIPE: IntegrationRecipe = {
  alias: "stripe",
  packages: [{ packageName: "stripe" }],
  supportedVersionRange: ">=17.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: SERVER_CONTEXTS,
    denied: ["client", "shared", "query", "liveQuery", "command"],
  },
  capabilities: networkCapability(["api.stripe.com"], ["recipe:stripe"]),
  secrets: [
    secret("STRIPE_SECRET_KEY"),
    secret("STRIPE_WEBHOOK_SECRET"),
  ],
  adapters: ["stripe.server.ts"],
  testkits: ["stripe.mock.ts"],
  docs: ["stripe.md"],
};

export const POSTHOG_RECIPE: IntegrationRecipe = {
  alias: "posthog",
  packages: [
    {
      packageName: "posthog-js",
      role: "client",
      contexts: {
        allowed: [...CLIENT_CONTEXTS, "shared", "test", "build"],
        denied: ["server", "query", "liveQuery", "command", "action", "workflow", "endpoint", "edge"],
      },
    },
    {
      packageName: "posthog-node",
      role: "server",
      contexts: {
        allowed: SERVER_CONTEXTS,
        denied: ["client", "shared", "query", "liveQuery", "command"],
      },
    },
  ],
  supportedVersionRange: ">=3.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: [...CLIENT_CONTEXTS, ...SERVER_CONTEXTS],
    denied: ["query", "liveQuery", "command"],
  },
  capabilities: networkCapability(
    ["*.posthog.com", "us.i.posthog.com", "eu.i.posthog.com"],
    ["recipe:posthog"],
  ),
  secrets: [
    secret("NEXT_PUBLIC_POSTHOG_KEY"),
    secret("POSTHOG_KEY"),
    secret("POSTHOG_HOST", false),
  ],
  adapters: ["posthog.client.ts", "posthog.server.ts"],
  testkits: ["posthog.mock.ts"],
  docs: ["posthog.md"],
};

export const SENTRY_RECIPE: IntegrationRecipe = {
  alias: "sentry",
  packages: [
    {
      packageName: "@sentry/nextjs",
      role: "framework",
      contexts: {
        allowed: [...CLIENT_CONTEXTS, ...SERVER_CONTEXTS, "edge"],
        denied: ["query", "liveQuery", "command"],
      },
    },
    {
      packageName: "@sentry/node",
      role: "server",
      contexts: {
        allowed: SERVER_CONTEXTS,
        denied: ["client", "shared", "query", "liveQuery", "command"],
      },
    },
    {
      packageName: "@sentry/browser",
      role: "client",
      contexts: {
        allowed: [...CLIENT_CONTEXTS, "shared", "test", "build"],
        denied: ["server", "query", "liveQuery", "command", "action", "workflow", "endpoint", "edge"],
      },
    },
  ],
  supportedVersionRange: ">=8.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: [...CLIENT_CONTEXTS, ...SERVER_CONTEXTS, "edge"],
    denied: ["query", "liveQuery", "command"],
  },
  capabilities: networkCapability(
    ["*.sentry.io", "sentry.io"],
    ["recipe:sentry", "source-map upload flow"],
  ),
  secrets: [
    secret("SENTRY_DSN"),
    secret("SENTRY_AUTH_TOKEN", false),
    secret("SENTRY_ORG", false),
    secret("SENTRY_PROJECT", false),
  ],
  adapters: ["sentry.client.ts", "sentry.server.ts"],
  testkits: ["sentry.mock.ts"],
  docs: ["sentry.md"],
};

export const ZOD_RECIPE: IntegrationRecipe = {
  alias: "zod",
  packages: [{ packageName: "zod" }],
  supportedVersionRange: ">=3.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: ALL_CONTEXTS,
    denied: [],
  },
  capabilities: emptyCapabilitySet(),
  secrets: [],
  adapters: ["zod.shared.ts"],
  testkits: ["zod.mock.ts"],
  docs: ["zod.md"],
};

export const AI_RECIPE: IntegrationRecipe = {
  alias: "ai",
  packages: [{ packageName: "ai" }],
  supportedVersionRange: ">=4.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: SERVER_CONTEXTS,
    denied: ["client", "shared", "query", "liveQuery", "command"],
  },
  capabilities: networkCapability(
    ["provider-dependent"],
    ["recipe:ai", "provider packages classified separately"],
  ),
  secrets: [],
  adapters: ["ai.server.ts"],
  testkits: ["ai.mock.ts"],
  docs: ["ai.md"],
};

export const AI_PROVIDER_RECIPES: IntegrationRecipe[] = [
  {
    alias: "@ai-sdk/openai",
    packages: [{ packageName: "@ai-sdk/openai", role: "provider" }],
    supportedVersionRange: ">=1.0.0",
    recipeVersion: "1.0.0",
    contexts: {
      allowed: SERVER_CONTEXTS,
      denied: ["client", "shared", "query", "liveQuery", "command"],
    },
    capabilities: networkCapability(["api.openai.com"], ["recipe:@ai-sdk/openai"]),
    secrets: [secret("OPENAI_API_KEY")],
    adapters: ["ai.openai.server.ts"],
    testkits: ["ai.openai.mock.ts"],
    docs: ["ai-openai.md"],
  },
  {
    alias: "@ai-sdk/anthropic",
    packages: [{ packageName: "@ai-sdk/anthropic", role: "provider" }],
    supportedVersionRange: ">=1.0.0",
    recipeVersion: "1.0.0",
    contexts: {
      allowed: SERVER_CONTEXTS,
      denied: ["client", "shared", "query", "liveQuery", "command"],
    },
    capabilities: networkCapability(["api.anthropic.com"], ["recipe:@ai-sdk/anthropic"]),
    secrets: [secret("ANTHROPIC_API_KEY")],
    adapters: ["ai.anthropic.server.ts"],
    testkits: ["ai.anthropic.mock.ts"],
    docs: ["ai-anthropic.md"],
  },
];

export const REFERENCE_ALIASES = [
  "stripe",
  "posthog",
  "sentry",
  "zod",
  "ai",
] as const;

export type ReferenceAlias = (typeof REFERENCE_ALIASES)[number];
