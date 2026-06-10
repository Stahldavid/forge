import type { LiveMessage } from "./types.ts";

export function encodeSseMessage(message: LiveMessage): string {
  const eventName = message.type === "snapshot" ? "snapshot" : "error";
  return `event: ${eventName}\ndata: ${JSON.stringify(message)}\n\n`;
}

export function createSseResponse(
  setup: (send: (message: LiveMessage) => void, close: () => void) => void | Promise<void>,
  onCancel?: () => void,
): Response {
  const encoder = new TextEncoder();
  let closed = false;

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
          controller.close();
        }
      };

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
