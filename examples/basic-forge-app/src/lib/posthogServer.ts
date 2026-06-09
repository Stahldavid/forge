import { PostHog } from "posthog-node";

export const posthogServer = new PostHog(process.env.POSTHOG_KEY ?? "phc_placeholder");
