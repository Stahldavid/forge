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

const AI_CONTEXTS: RuntimeContext[] = [
  "server",
  "action",
  "workflow",
  "endpoint",
  "test",
  "build",
];

const AI_DENIED_CONTEXTS: RuntimeContext[] = [
  "shared",
  "client",
  "query",
  "liveQuery",
  "command",
  "edge",
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
  recipeVersion: "2.0.0",
  contexts: {
    allowed: SERVER_CONTEXTS,
    denied: ["client", "shared", "query", "liveQuery", "command"],
  },
  capabilities: networkCapability(["api.stripe.com"], ["recipe:stripe"]),
  secrets: [
    secret("STRIPE_SECRET_KEY"),
    secret("STRIPE_WEBHOOK_SECRET"),
  ],
  adapters: ["stripe.server.ts", "stripe.workflow.ts"],
  integrations: ["stripe/webhook.ts"],
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
  recipeVersion: "2.0.0",
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
  integrations: ["posthog/events.ts", "posthog/flags.ts"],
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
  recipeVersion: "2.0.0",
  frameworkTarget: "nextjs",
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
  integrations: [
    "sentry/errors.ts",
    "sentry/releases.ts",
    "sentry/sourcemaps.ts",
  ],
  testkits: ["sentry.mock.ts"],
  docs: ["sentry.md"],
};

export const ZOD_RECIPE: IntegrationRecipe = {
  alias: "zod",
  packages: [{ packageName: "zod" }],
  supportedVersionRange: ">=3.0.0",
  recipeVersion: "2.0.0",
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

export const CONVEX_RECIPE: IntegrationRecipe = {
  alias: "convex",
  packages: [{ packageName: "convex" }],
  supportedVersionRange: ">=1.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: ["client", "server", "action", "workflow", "endpoint", "test", "build"],
    denied: ["shared", "query", "liveQuery", "command", "edge"],
  },
  capabilities: networkCapability(
    ["*.convex.cloud", "*.convex.site"],
    ["recipe:convex", "Convex client/server package connects to Convex deployments"],
  ),
  secrets: [
    secret("NEXT_PUBLIC_CONVEX_URL", false),
    secret("CONVEX_URL", false),
    secret("CONVEX_DEPLOYMENT", false),
    secret("CONVEX_DEPLOY_KEY", false),
  ],
  adapters: [],
  testkits: ["convex.mock.ts"],
  docs: ["convex.md"],
};

export const WORKOS_RECIPE: IntegrationRecipe = {
  alias: "workos",
  packages: [{ packageName: "@workos-inc/node" }],
  supportedVersionRange: ">=10.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: ["server", "action", "workflow", "endpoint", "test", "build"],
    denied: ["shared", "client", "query", "liveQuery", "command", "edge"],
  },
  capabilities: networkCapability(
    ["api.workos.com"],
    ["recipe:workos", "WorkOS SDK calls AuthKit, Organizations, Admin Portal, and FGA APIs"],
  ),
  secrets: [
    secret("WORKOS_API_KEY"),
    secret("WORKOS_CLIENT_ID"),
    secret("WORKOS_COOKIE_PASSWORD"),
    secret("WORKOS_REDIRECT_URI", false),
    secret("WORKOS_WEBHOOK_SECRET", false),
  ],
  adapters: ["workos.server.ts"],
  integrations: [
    "workos/authkit.ts",
    "workos/auth-routes.ts",
    "workos/fga.ts",
    "workos/http-handler.ts",
    "workos/resource-map.ts",
    "workos/seed.ts",
    "workos/session.ts",
    "workos/webhook.ts",
    "workos/workos-seed.yml",
  ],
  rootFiles: [".env.example", "src/policies.workos.ts"],
  testkits: ["workos.mock.ts"],
  docs: ["workos.md"],
};

export const FORGE_RECIPE: IntegrationRecipe = {
  alias: "forge",
  packages: [{ packageName: "forge" }],
  supportedVersionRange: ">=0.0.0",
  recipeVersion: "1.0.0",
  contexts: {
    allowed: ALL_CONTEXTS,
    denied: [],
  },
  capabilities: emptyCapabilitySet(),
  secrets: [],
  adapters: [],
  testkits: [],
  docs: ["AGENTS.md"],
};

export const AI_RECIPE: IntegrationRecipe = {
  alias: "ai",
  packages: [{ packageName: "ai" }],
  supportedVersionRange: ">=5.0.0",
  recipeVersion: "2.0.0",
  contexts: {
    allowed: AI_CONTEXTS,
    denied: AI_DENIED_CONTEXTS,
  },
  capabilities: networkCapability(
    ["provider-dependent"],
    ["recipe:ai", "provider packages classified separately"],
  ),
  secrets: [
    secret("OPENAI_API_KEY"),
    secret("ANTHROPIC_API_KEY"),
    secret("AI_GATEWAY_API_KEY", false),
  ],
  adapters: ["ai.server.ts"],
  integrations: ["ai/generations.ts", "ai/testkit.ts"],
  testkits: ["ai.mock.ts"],
  docs: ["ai.md"],
};

export const AI_PROVIDER_RECIPES: IntegrationRecipe[] = [
  {
    alias: "ai-provider-openai",
    packages: [{ packageName: "@ai-sdk/openai", role: "provider" }],
    supportedVersionRange: ">=1.0.0",
    recipeVersion: "1.0.0",
    contexts: {
      allowed: AI_CONTEXTS,
      denied: AI_DENIED_CONTEXTS,
    },
    capabilities: networkCapability(["api.openai.com"], ["recipe:ai-provider-openai"]),
    secrets: [secret("OPENAI_API_KEY")],
    adapters: ["ai.openai.server.ts"],
    testkits: ["ai.openai.mock.ts"],
    docs: ["ai-openai.md"],
  },
  {
    alias: "ai-provider-anthropic",
    packages: [{ packageName: "@ai-sdk/anthropic", role: "provider" }],
    supportedVersionRange: ">=1.0.0",
    recipeVersion: "1.0.0",
    contexts: {
      allowed: AI_CONTEXTS,
      denied: AI_DENIED_CONTEXTS,
    },
    capabilities: networkCapability(["api.anthropic.com"], ["recipe:ai-provider-anthropic"]),
    secrets: [secret("ANTHROPIC_API_KEY")],
    adapters: ["ai.anthropic.server.ts"],
    testkits: ["ai.anthropic.mock.ts"],
    docs: ["ai-anthropic.md"],
  },
  {
    alias: "ai-gateway",
    packages: [{ packageName: "ai", role: "gateway" }],
    supportedVersionRange: ">=5.0.0",
    recipeVersion: "1.0.0",
    contexts: {
      allowed: AI_CONTEXTS,
      denied: AI_DENIED_CONTEXTS,
    },
    capabilities: networkCapability(["gateway.ai.vercel.dev"], ["recipe:ai-gateway"]),
    secrets: [secret("AI_GATEWAY_API_KEY")],
    adapters: ["ai.gateway.server.ts"],
    testkits: ["ai.gateway.mock.ts"],
    docs: ["ai-gateway.md"],
  },
];

export const REFERENCE_ALIASES = [
  "stripe",
  "posthog",
  "sentry",
  "zod",
  "convex",
  "workos",
  "ai",
] as const;

export type ReferenceAlias = (typeof REFERENCE_ALIASES)[number];
