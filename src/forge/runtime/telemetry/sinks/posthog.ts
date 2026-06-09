import type { ForgeTelemetryEnvelope } from "../types.ts";

export interface PosthogCaptureFn {
  (event: string, properties: Record<string, unknown>, distinctId: string): Promise<void> | void;
}

let injectedCapture: PosthogCaptureFn | null = null;

export function setPosthogCaptureForTests(fn: PosthogCaptureFn | null): void {
  injectedCapture = fn;
}

export async function sendToPosthog(
  envelope: ForgeTelemetryEnvelope,
  workspaceRoot: string,
): Promise<void> {
  if (envelope.type !== "event" || !envelope.event) {
    return;
  }

  if (injectedCapture) {
    await injectedCapture(
      envelope.event.name,
      {
        ...envelope.event.properties,
        traceId: envelope.traceId,
        requestId: envelope.requestId,
        runtime: envelope.runtime,
      },
      envelope.traceId,
    );
    return;
  }

  try {
    const adapterPath = `${workspaceRoot}/src/forge/_generated/packages/posthog.server.ts`.replace(
      /\\/g,
      "/",
    );
    const mod = (await import(adapterPath)) as {
      createPosthogServer?: () => { capture: (args: unknown) => void; shutdown: () => Promise<void> };
    };

    if (typeof mod.createPosthogServer === "function") {
      const client = mod.createPosthogServer();
      client.capture({
        distinctId: envelope.traceId,
        event: envelope.event.name,
        properties: {
          ...envelope.event.properties,
          traceId: envelope.traceId,
          requestId: envelope.requestId,
          runtime: envelope.runtime,
        },
      });
      await client.shutdown();
      return;
    }
  } catch {
    /* fall through — adapter not installed */
  }

  throw new Error("posthog adapter not available");
}
