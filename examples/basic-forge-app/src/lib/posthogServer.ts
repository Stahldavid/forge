import { createPostHog, type PostHog } from "posthog-node";
import type { ForgeContext } from "forge/server";

export function createPosthogServer(
  secrets: ForgeContext["secrets"],
  _env: ForgeContext["env"],
): PostHog {
  return createPostHog(secrets.get("POSTHOG_KEY"));
}
