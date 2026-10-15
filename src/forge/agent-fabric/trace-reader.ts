import { explainDeltaTrace, validateTraceExplanationTarget, type TraceExplanationFilter } from "../delta/trace-projection.ts";
import { requestExistingDeltaBroker } from "../delta/broker.ts";
import { readTraceOwnerConfiguration } from "./trace-owner-runtime.ts";
import { assertTraceIdentity, normalizeTraceAgentMemorySlice, normalizeTraceRunKey, traceAgentMemorySliceDigest } from "./trace-contract.ts";
import type { AgentMemoryEventRecord } from "../agent-memory/types.ts";

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
/** Adds bounded primary-source availability to the immutable historical binding view. No store is initialized. */
export async function explainFabricTrace(root: string, filter: TraceExplanationFilter): Promise<unknown> {
  filter = { ...filter, runKey: normalizeTraceRunKey(filter.runKey) };
  validateTraceExplanationTarget(filter);
  const configuration = await readTraceOwnerConfiguration(root);
  if (configuration) assertTraceIdentity(filter.runKey, configuration.identity);
  const result = await explainDeltaTrace(root, filter);
  if (!object(result) || !object(result.agentMemory) || !Array.isArray(result.agentMemory.bindings)) return result;
  const readBudgetMs = 3000, deadline = Date.now() + readBudgetMs;
  let readsPerformed = 0, readBudgetExhausted = false;
  const bindings: Record<string, unknown>[] = [];
  for (const raw of result.agentMemory.bindings.slice(0, 128)) {
    if (!object(raw)) continue;
    const binding = { ...raw, primaryAvailability: "unverified" };
    if (configuration?.memory && raw.memoryStoreId === configuration.memory.memoryStoreId && raw.sourceNamespace === configuration.memory.sourceNamespace && typeof raw.eventId === "string") {
      try {
        const remaining = deadline - Date.now();
        if (remaining < 1) { readBudgetExhausted = true; binding.primaryAvailability = "source-unavailable"; bindings.push(binding); continue; }
        readsPerformed++;
        const event = await requestExistingDeltaBroker(root, "traceReadAgentMemoryEvent", [raw.eventId], Math.min(remaining, 1000)) as AgentMemoryEventRecord | null;
        if (!event) binding.primaryAvailability = "source-expired";
        else if (!event.externalSessionId) binding.primaryAvailability = "source-conflict";
        else {
          const slice = normalizeTraceAgentMemorySlice({ sourceNamespace: configuration.memory.sourceNamespace, integration: event.integrationKind,
            externalSessionId: event.externalSessionId, ...(event.externalTurnId ? { turnId: event.externalTurnId } : {}), eventType: event.eventKind, ...(event.summary ? { summary: event.summary } : {}) });
          binding.primaryAvailability = traceAgentMemorySliceDigest(slice) === raw.eventDigest ? "available" : "source-conflict";
        }
      } catch { binding.primaryAvailability = "source-unavailable"; }
    }
    bindings.push(binding);
  }
  const states = bindings.map(item => item.primaryAvailability);
  const partial = (object(result.projection) && result.projection.graphScope === "page") || result.truncated === true || result.agentMemory.bindings.length > 128;
  const availability = partial ? "unknown-in-partial-result" : !bindings.length ? "pending" : states.every(state => state === "available") ? "available"
    : states.includes("source-conflict") ? "source-conflict" : states.includes("source-expired") ? "source-expired" : "primary-source-unverified";
  return { ...result, agentMemory: { ...result.agentMemory, mode: "pinned-bindings-and-bounded-primary-read", bindings, availability,
    readLimit: 128, readBudgetMs, readsPerformed, readBudgetExhausted, truncated: result.agentMemory.bindings.length > 128 }, gaps: [
    ...(Array.isArray(result.gaps) ? result.gaps : []), ...(availability === "source-expired" ? ["agent-memory-source-expired"] : []),
    ...(availability === "source-conflict" ? ["agent-memory-source-conflict"] : []),
    ...(states.includes("source-unavailable") ? ["agent-memory-source-unavailable"] : []),
    ...(readBudgetExhausted ? ["agent-memory-read-budget-exceeded"] : []),
  ] };
}
