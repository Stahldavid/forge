import type { DbAdapter } from "../db/adapter.ts";
import { flushPendingTelemetry } from "./flush.ts";

export async function processTelemetryBatch(
  adapter: DbAdapter,
  workspaceRoot: string,
  sinks: string[] = ["local"],
  limit = 50,
): Promise<{ processed: number; failed: number }> {
  let processed = 0;
  let failed = 0;

  for (const sink of sinks) {
    const result = await flushPendingTelemetry(adapter, sink, workspaceRoot, limit);
    processed += result.processed;
    failed += result.failed;
  }

  return { processed, failed };
}
