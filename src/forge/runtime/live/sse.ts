import type { LiveMessage } from "./types.ts";

export function encodeSseMessage(message: LiveMessage): string {
  const id = message.type === "snapshot" ? `id: ${message.revision}\n` : "";
  return `${id}event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
}

export function createSseResponse(
  setup: (send: (message: LiveMessage) => void, close: () => void) => void | Promise<void>,
  onCancel?: () => void,
  options?: { heartbeatIntervalMs?: number; hello?: LiveMessage },
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (message: LiveMessage) => {
        if (!closed) {
          controller.enqueue(encoder.encode(encodeSseMessage(message)));
        }
      };
      const close = () => {
        if (!closed) {
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
            heartbeat = null;
          }
          controller.close();
        }
      };

      if (options?.hello) {
        send(options.hello);
      }
      if (options?.heartbeatIntervalMs) {
        heartbeat = setInterval(() => {
          send({ type: "heartbeat", serverTime: new Date().toISOString() });
        }, options.heartbeatIntervalMs);
        (heartbeat as { unref?: () => void }).unref?.();
      }

      void Promise.resolve(setup(send, close)).catch((error) => {
        if (!closed) {
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message })}\n\n`),
          );
          closed = true;
          controller.close();
        }
      });
    },
    cancel() {
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      onCancel?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
