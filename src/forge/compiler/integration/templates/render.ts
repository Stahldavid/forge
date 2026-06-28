import type { IntegrationTemplateInput } from "./types.ts";
import * as ai from "./ai.ts";
import * as convex from "./convex.ts";
import * as posthog from "./posthog.ts";
import * as sentry from "./sentry.ts";
import * as stripe from "./stripe.ts";
import * as workos from "./workos.ts";
import * as zod from "./zod.ts";

type TemplateRenderer = (input: IntegrationTemplateInput) => string;

const ADAPTER_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  zod: {
    "zod.shared.ts": zod.renderZodAdapter,
  },
  stripe: {
    "stripe.server.ts": stripe.renderStripeServerAdapter,
    "stripe.workflow.ts": stripe.renderStripeWorkflowAdapter,
  },
  posthog: {
    "posthog.client.ts": posthog.renderPosthogClientAdapter,
    "posthog.server.ts": posthog.renderPosthogServerAdapter,
  },
  sentry: {
    "sentry.client.ts": sentry.renderSentryClientAdapter,
    "sentry.server.ts": sentry.renderSentryServerAdapter,
  },
  ai: {
    "ai.server.ts": ai.renderAiServerAdapter,
  },
  workos: {
    "workos.server.ts": workos.renderWorkosServerAdapter,
  },
};

const INTEGRATION_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  stripe: {
    "stripe/webhook.ts": stripe.renderStripeWebhook,
  },
  posthog: {
    "posthog/events.ts": posthog.renderPosthogEvents,
    "posthog/flags.ts": posthog.renderPosthogFlags,
  },
  sentry: {
    "sentry/errors.ts": sentry.renderSentryErrors,
    "sentry/releases.ts": sentry.renderSentryReleases,
    "sentry/sourcemaps.ts": sentry.renderSentrySourcemaps,
  },
  ai: {
    "ai/generations.ts": ai.renderAiGenerations,
    "ai/testkit.ts": ai.renderAiTestkit,
  },
  workos: {
    "workos/authkit.ts": workos.renderWorkosAuthkit,
    "workos/auth-routes.ts": workos.renderWorkosAuthRoutes,
    "workos/fga.ts": workos.renderWorkosFga,
    "workos/http-handler.ts": workos.renderWorkosHttpHandler,
    "workos/resource-map.ts": workos.renderWorkosResourceMap,
    "workos/seed.ts": workos.renderWorkosSeed,
    "workos/session.ts": workos.renderWorkosSession,
    "workos/webhook.ts": workos.renderWorkosWebhook,
    "workos/workos-seed.yml": workos.renderWorkosSeedYaml,
  },
};

const TESTKIT_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  zod: { "zod.mock.ts": zod.renderZodTestkit },
  stripe: { "stripe.mock.ts": stripe.renderStripeTestkit },
  posthog: { "posthog.mock.ts": posthog.renderPosthogTestkit },
  sentry: { "sentry.mock.ts": sentry.renderSentryTestkit },
  convex: { "convex.mock.ts": convex.renderConvexTestkit },
  ai: { "ai.mock.ts": ai.renderAiTestkitLegacy },
  workos: { "workos.mock.ts": workos.renderWorkosTestkit },
};

const DOC_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  zod: { "zod.md": zod.renderZodDoc },
  stripe: { "stripe.md": stripe.renderStripeDoc },
  posthog: { "posthog.md": posthog.renderPosthogDoc },
  sentry: { "sentry.md": sentry.renderSentryDoc },
  convex: { "convex.md": convex.renderConvexDoc },
  ai: { "ai.md": ai.renderAiDoc },
  workos: { "workos.md": workos.renderWorkosDoc },
};

const ROOT_FILE_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  workos: {
    ".env.example": workos.renderWorkosEnvExample,
    "src/policies.workos.ts": workos.renderWorkosPolicies,
    "web/src/lib/workos-auth.tsx": workos.renderWorkosReactBridge,
    "workos-seed.yml": workos.renderWorkosSeedYaml,
  },
};

function lookup(
  table: Record<string, Record<string, TemplateRenderer>>,
  alias: string,
  filename: string,
): TemplateRenderer | null {
  return table[alias]?.[filename] ?? null;
}

export function renderQualityAdapter(
  filename: string,
  input: IntegrationTemplateInput,
): string | null {
  return lookup(ADAPTER_RENDERERS, input.alias, filename)?.(input) ?? null;
}

export function renderQualityIntegration(
  relativePath: string,
  input: IntegrationTemplateInput,
): string | null {
  return lookup(INTEGRATION_RENDERERS, input.alias, relativePath)?.(input) ?? null;
}

export function renderQualityTestkit(
  filename: string,
  input: IntegrationTemplateInput,
): string | null {
  return lookup(TESTKIT_RENDERERS, input.alias, filename)?.(input) ?? null;
}

export function renderQualityDoc(
  filename: string,
  input: IntegrationTemplateInput,
): string | null {
  return lookup(DOC_RENDERERS, input.alias, filename)?.(input) ?? null;
}

export function renderQualityRootFile(
  filename: string,
  input: IntegrationTemplateInput,
): string | null {
  return lookup(ROOT_FILE_RENDERERS, input.alias, filename)?.(input) ?? null;
}

export function buildTemplateInput(input: {
  alias: string;
  recipe: IntegrationTemplateInput["recipe"];
  context: IntegrationTemplateInput["context"];
  packageName: string;
  packageNames: string[];
  secrets: IntegrationTemplateInput["secrets"];
  compatible: IntegrationTemplateInput["compatible"];
  incompatible: IntegrationTemplateInput["incompatible"];
  workspaceRoot?: string;
  appGraph?: IntegrationTemplateInput["appGraph"];
}): IntegrationTemplateInput {
  return input;
}
