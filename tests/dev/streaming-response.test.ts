import { describe, expect, test } from "bun:test";
import type { ServerResponse } from "node:http";
import { writeFetchResponse } from "../../src/forge/dev/server.ts";

describe("dev server response writer", () => {
  test("writes streaming chunks before the response body closes", async () => {
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let sawWrite!: () => void;
    const wrote = new Promise<void>((resolve) => {
      sawWrite = resolve;
    });
    const chunks: Buffer[] = [];
    const headers: Record<string, string | number | string[]> = {};

    const response = {
      statusCode: 0,
      setHeader(name: string, value: string | number | string[]) {
        headers[name.toLowerCase()] = value;
      },
      write(chunk: Uint8Array) {
        chunks.push(Buffer.from(chunk));
        sawWrite();
        return true;
      },
      end() {
        // no-op
      },
      destroy(error?: Error) {
        if (error) {
          throw error;
        }
      },
    } as unknown as ServerResponse;

    const body = new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        streamController.enqueue(encoder.encode("event: hello\n\n"));
      },
    });

    const writing = writeFetchResponse(
      response,
      new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    await Promise.race([
      wrote,
      new Promise((_, reject) => setTimeout(() => reject(new Error("stream did not flush")), 1_000)),
    ]);

    expect(response.statusCode).toBe(200);
    expect(headers["content-type"]).toBe("text/event-stream");
    expect(Buffer.concat(chunks).toString("utf8")).toContain("event: hello");

    controller.close();
    await writing;
  });
});
