import { join } from "node:path";
import { nodeFileSystem } from "../../../compiler/fs/index.ts";
import type { ForgeTelemetryEnvelope } from "../types.ts";

function telemetryDir(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "local", "telemetry");
}

function fileForType(type: ForgeTelemetryEnvelope["type"], workspaceRoot: string): string {
  const dir = telemetryDir(workspaceRoot);
  if (type === "exception") {
    return join(dir, "exceptions.jsonl");
  }
  if (type === "span.start" || type === "span.end") {
    return join(dir, "spans.jsonl");
  }
  return join(dir, "events.jsonl");
}

export async function writeLocalJsonl(
  envelope: ForgeTelemetryEnvelope,
  workspaceRoot: string,
): Promise<void> {
  const file = fileForType(envelope.type, workspaceRoot);
  nodeFileSystem.appendText(file, `${JSON.stringify(envelope)}\n`);
}

export function localJsonlPaths(workspaceRoot: string): {
  events: string;
  exceptions: string;
  spans: string;
} {
  const dir = telemetryDir(workspaceRoot);
  return {
    events: join(dir, "events.jsonl"),
    exceptions: join(dir, "exceptions.jsonl"),
    spans: join(dir, "spans.jsonl"),
  };
}
