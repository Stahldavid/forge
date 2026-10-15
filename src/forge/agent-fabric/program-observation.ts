import { programAssert, programDigest, programValueBytes, type ProgramAttempt } from "./program-contract.ts";

/** Adapter observations are data, not completion or acceptance authority. */
export interface ProgramWorkerObservation {
  id: string; type: string; source: string; at: string;
  usage?: { input_tokens: number; cached_input_tokens?: number; output_tokens: number };
  semantics?: "incremental" | "cumulative";
  metadata?: Record<string, unknown>;
}
export interface ProgramUsageSummary {
  inputTokens: number; outputTokens: number; cachedInputTokens: number;
  totalTokens: number; certainty: "observed" | "unknown" | "not-applicable";
}
export function recordProgramObservation(attempt: ProgramAttempt, observation: ProgramWorkerObservation): void {
  programValueBytes(observation, 16384, 128);
  programAssert(typeof observation.id === "string" && observation.id.length > 0 && observation.id.length <= 256 &&
    typeof observation.type === "string" && observation.type.length <= 128 && typeof observation.source === "string" && observation.source.length <= 128 &&
    Number.isFinite(Date.parse(observation.at)), "Invalid worker observation");
  programAssert(observation.semantics === undefined || ["incremental", "cumulative"].includes(observation.semantics), "Invalid usage semantics");
  if (observation.usage) {
    const usage = observation.usage;
    programAssert(Number.isSafeInteger(usage.input_tokens) && usage.input_tokens >= 0 && Number.isSafeInteger(usage.output_tokens) && usage.output_tokens >= 0, "Usage requires nonnegative safe input/output counters");
    programAssert(usage.cached_input_tokens === undefined || Number.isSafeInteger(usage.cached_input_tokens) && usage.cached_input_tokens >= 0 && usage.cached_input_tokens <= usage.input_tokens, "Invalid cached usage counter");
  }
  const observations = attempt.observations ??= {};
  if (observations[observation.id]) { programAssert(programDigest(observations[observation.id]) === programDigest(observation), "Observation identity changed"); return; }
  programAssert(Object.keys(observations).length < 1024, "Attempt observation budget exceeded");
  const next = { ...attempt, observations: { ...observations, [observation.id]: structuredClone(observation) } };
  const summary = summarizeProgramUsage(next);
  observations[observation.id] = next.observations[observation.id];
  attempt.usageSummary = summary;
}
export function summarizeProgramUsage(attempt: ProgramAttempt): ProgramUsageSummary {
  let inputTokens = 0, outputTokens = 0, cachedInputTokens = 0, observed = false;
  const cumulative = new Map<string, NonNullable<ProgramWorkerObservation["usage"]>>();
  const semantics = new Map<string, string>();
  for (const observation of Object.values(attempt.observations ?? {})) {
    if (!observation.usage) continue; observed = true;
    const mode = observation.semantics ?? "incremental";
    programAssert(!semantics.has(observation.source) || semantics.get(observation.source) === mode, "Usage source mixes cumulative and incremental semantics");
    semantics.set(observation.source, mode);
    if (observation.semantics === "cumulative") {
      const previous = cumulative.get(observation.source);
      cumulative.set(observation.source, { input_tokens: Math.max(previous?.input_tokens ?? 0, observation.usage.input_tokens), output_tokens: Math.max(previous?.output_tokens ?? 0, observation.usage.output_tokens), cached_input_tokens: Math.max(previous?.cached_input_tokens ?? 0, observation.usage.cached_input_tokens ?? 0) });
    } else { inputTokens += observation.usage.input_tokens; outputTokens += observation.usage.output_tokens; cachedInputTokens += observation.usage.cached_input_tokens ?? 0; }
  }
  for (const usage of cumulative.values()) { inputTokens += usage.input_tokens; outputTokens += usage.output_tokens; cachedInputTokens += usage.cached_input_tokens ?? 0; }
  if (!observed && attempt.usage && typeof attempt.usage === "object") {
    const usage = attempt.usage as { input_tokens?: number; output_tokens?: number; cached_input_tokens?: number };
    if (Number.isSafeInteger(usage.input_tokens) && Number.isSafeInteger(usage.output_tokens) && usage.input_tokens! >= 0 && usage.output_tokens! >= 0) {
      inputTokens = usage.input_tokens!; outputTokens = usage.output_tokens!;
      cachedInputTokens = Number.isSafeInteger(usage.cached_input_tokens) && usage.cached_input_tokens! >= 0 ? usage.cached_input_tokens! : 0; observed = true;
    }
  }
  programAssert([inputTokens, outputTokens, cachedInputTokens, inputTokens + outputTokens].every(value => Number.isSafeInteger(value) && value >= 0), "Usage aggregate exceeds safe integer range");
  return { inputTokens, outputTokens, cachedInputTokens, totalTokens: inputTokens + outputTokens, certainty: observed ? "observed" : attempt.usageApplicability === "not-applicable" ? "not-applicable" : "unknown" };
}
/** Held reservations and unknown completed calls remain liabilities after owner restart. */
export function programResourceLiability(attempt: ProgramAttempt): number {
  const usage = summarizeProgramUsage(attempt);
  const reserve = attempt.resourceReservation?.tokens ?? 0;
  return usage.totalTokens + (attempt.resourceReservation?.status === "held" ? Math.max(0, reserve - usage.totalTokens) : usage.certainty === "unknown" ? reserve : 0);
}
