import { init } from "posthog-js";

declare const process: {
  env: {
    NEXT_PUBLIC_POSTHOG_KEY?: string;
  };
};

export const posthogClient = init(
  process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "phc_placeholder",
);
