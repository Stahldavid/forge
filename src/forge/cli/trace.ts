import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { DeltaStore } from "../delta/store.ts";
import type { TraceExplanationFilter } from "../delta/trace-projection.ts";
import { explainFabricTrace } from "../agent-fabric/trace-reader.ts";
import { requestExistingDeltaBroker } from "../delta/broker.ts";
import { projectFabricTrace } from "../agent-fabric/trace-projector.ts";
import { readTraceOwnerConfiguration } from "../agent-fabric/trace-owner-runtime.ts";
import { normalizeTraceRunKey, traceObject, traceOpaque, assertTraceIdentity } from "../agent-fabric/trace-contract.ts";
import { programAssert } from "../agent-fabric/program-contract.ts";

export interface TraceCliOptions { subcommand: "project" | "rebuild" | "explain" | "status"; workspaceRoot: string; json: boolean; file?: string }
export async function runTraceCommand(options: TraceCliOptions): Promise<number> {
  try {
    const root = await realpath(options.workspaceRoot); let body: Record<string, unknown> = {};
    if (options.file) {
      const file = await realpath(resolve(root, options.file)), rel = relative(root, file);
      programAssert(rel && !rel.startsWith("..") && !isAbsolute(rel) && (await stat(file)).size <= 64 * 1024, "Trace request must be inside the selected checkout", "TRACE_INVALID_REFERENCE");
      body = traceObject(JSON.parse(await readFile(file, "utf8")), ["generationId", "runIds", "activate", "runKey", "candidateId", "path", "atVersion", "limit", "offset"]);
    }
    let result: unknown;
    if (options.subcommand === "status") {
      try { result = await requestExistingDeltaBroker(root, "traceStatus", [body.generationId]); }
      catch { result = { status: "unavailable", gaps: ["projection-unavailable"] }; }
    } else if (options.subcommand === "explain") {
      const runKey = normalizeTraceRunKey(body.runKey), configuration = await readTraceOwnerConfiguration(root);
      if (configuration) assertTraceIdentity(runKey, configuration.identity);
      result = await explainFabricTrace(root, { ...body, runKey } as TraceExplanationFilter);
    } else {
      const configuration = await readTraceOwnerConfiguration(root);
      programAssert(configuration, "Trace owner configuration unavailable", "TRACE_SOURCE_UNAVAILABLE");
      const generationId = traceOpaque(body.generationId);
      programAssert(body.runIds === undefined || Array.isArray(body.runIds) && body.runIds.length > 0 && body.runIds.every(id => typeof id === "string"), "Invalid trace run inventory", "TRACE_INVALID_REFERENCE");
      programAssert(body.activate === undefined || typeof body.activate === "boolean", "Invalid trace activation", "TRACE_INVALID_REFERENCE");
      // Only explicit projection/rebuild commands may initialize the local index.
      const delta = await DeltaStore.open(root, { access: "write" });
      try {
        if (options.subcommand === "rebuild") programAssert((await delta.traceStatus(generationId)).status === "unavailable", "Rebuild requires a new generation", "TRACE_VERSION_CONFLICT");
        result = await projectFabricTrace({ root, identity: configuration.identity, delta, generationId,
          ...(body.runIds ? { runIds: body.runIds as string[] } : {}), activate: body.activate !== false });
      } finally { await delta.close(); }
    }
    process.stdout.write(`${JSON.stringify({ ok: true, result }, null, options.json ? 2 : undefined)}\n`); return 0;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" && /^TRACE_[A-Z_]+$/.test(error.code) ? error.code : "TRACE_OPERATION_FAILED";
    process.stdout.write(`${JSON.stringify({ ok: false, code })}\n`); return 1;
  }
}
