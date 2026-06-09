import posthog from "posthog-js";

export const posthogClient = posthog.init(
  process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_placeholder",
);
