import { programAssert, programDigest, type ProgramAcceptance, type ProgramCaptureReceipt, type ProgramPopulation, type ProgramVisualCase } from "./program-contract.ts";
import { canonicalItemKey } from "./program-structure.ts";

export function validateVisualPopulation(population: ProgramPopulation): void {
  if (!population.visualCases) return;
  const keys = population.members.map(canonicalItemKey), cases = population.visualCases;
  programAssert(cases.length === keys.length && new Set(cases.map(entry => canonicalItemKey(entry.itemKey))).size === keys.length && cases.every(entry => keys.includes(canonicalItemKey(entry.itemKey))), "Visual cases must cover exactly owner population");
  const tuples = cases.map(entry => programDigest([entry.route, entry.viewport, entry.state]));
  programAssert(new Set(tuples).size === tuples.length, "Duplicate visual route/viewport/state case");
  for (const entry of cases) programAssert([entry.route, entry.viewport, entry.state].every(value => typeof value === "string" && value.length > 0 && value.length <= 2048) && [entry.width, entry.height].every(value => Number.isSafeInteger(value) && value > 0 && value <= 16384) && entry.width * entry.height <= 64 * 1024 * 1024, "Invalid expected visual case");
}
export function captureKeys(acceptance: ProgramAcceptance, phase: "item" | "final", members: string[], itemKey?: string): string[] {
  const required = (acceptance.obligations ?? []).some(obligation => (phase === "final" || obligation.scope === "item") && obligation.requiredEvidence?.includes("capture"));
  if (!required) return [];
  programAssert(members.length > 0 && (phase !== "item" || itemKey && members.includes(itemKey)), "Capture obligations require an owner population");
  return phase === "item" ? [itemKey!] : members;
}
export function validateVisualCapture(capture: Pick<ProgramCaptureReceipt, "itemKey" | "route" | "viewport" | "state" | "width" | "height">, cases?: ProgramVisualCase[]): void {
  if (!cases) return;
  const expected = cases.find(entry => canonicalItemKey(entry.itemKey) === canonicalItemKey(capture.itemKey));
  programAssert(expected && ["route", "viewport", "state", "width", "height"].every(key => expected[key as keyof ProgramVisualCase] === capture[key as keyof typeof capture]), "Capture does not match owner visual case");
}
