import type { IntegrationTemplateInput } from "./types.ts";
import * as ai from "./ai.ts";
import * as posthog from "./posthog.ts";
import * as sentry from "./sentry.ts";
import * as stripe from "./stripe.ts";
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
    "ai/evals.ts": ai.renderAiEvals,
    "ai/providers/openai.ts": ai.renderAiOpenaiProvider,
    "ai/providers/anthropic.ts": ai.renderAiAnthropicProvider,
  },
};

const TESTKIT_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  zod: { "zod.mock.ts": zod.renderZodTestkit },
  stripe: { "stripe.mock.ts": stripe.renderStripeTestkit },
  posthog: { "posthog.mock.ts": posthog.renderPosthogTestkit },
  sentry: { "sentry.mock.ts": sentry.renderSentryTestkit },
  ai: { "ai.mock.ts": ai.renderAiTestkit },
};

const DOC_RENDERERS: Record<string, Record<string, TemplateRenderer>> = {
  zod: { "zod.md": zod.renderZodDoc },
  stripe: { "stripe.md": stripe.renderStripeDoc },
  posthog: { "posthog.md": posthog.renderPosthogDoc },
  sentry: { "sentry.md": sentry.renderSentryDoc },
  ai: { "ai.md": ai.renderAiDoc },
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

export function buildTemplateInput(input: {
  alias: string;
  recipe: IntegrationTemplateInput["recipe"];
  context: IntegrationTemplateInput["context"];
  packageName: string;
  packageNames: string[];
  secrets: IntegrationTemplateInput["secrets"];
  compatible: IntegrationTemplateInput["compatible"];
  incompatible: IntegrationTemplateInput["incompatible"];
}): IntegrationTemplateInput {
  return input;
}
