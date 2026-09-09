import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import schema from "../../schemas/agent-fabric/v0.1/control-event.schema.json";
import { AgentFabricError, replayControlState, validateControlEventEnvelope } from "../../src/forge/agent-fabric/index.ts";
import { completeTrace, rechain } from "./s11-fixtures.ts";

// Compile the repository's actual Draft 2020-12 schema, without coercion/defaults.
const validateSchema = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
const h = completeTrace();
const specimens = [...new Map(h.conductor.events().map((e) => [e.payload.type, e])).values()];

function parity(value: unknown, accepted: boolean) {
  expect(validateSchema(value)).toBe(accepted);
  if (accepted) expect(() => validateControlEventEnvelope(value)).not.toThrow();
  else {
    try { validateControlEventEnvelope(value); throw new Error("runtime accepted invalid vector"); }
    catch (error) {
      expect(error).toBeInstanceOf(AgentFabricError);
      expect((error as AgentFabricError).code).toBe("AF_INVALID_EVENT");
    }
  }
}

describe("S11-SCHEMA: structural parity for every payload family", () => {
  test("inventory contains all 16 accepted variants", () => expect(specimens).toHaveLength(16));
  for (const specimen of specimens) {
    const type = specimen.payload.type;
    test(`${type}: valid`, () => parity(specimen, true));
    for (const mutation of ["missing", "unknown", "wrong type", "null", "empty id", "negative time", "fractional sequence"] as const) {
      test(`${type}: ${mutation}`, () => {
        const value = structuredClone(specimen);
        const payload = value.payload as unknown as Record<string, unknown>;
        switch (mutation) {
          case "missing": delete payload[Object.keys(payload).find((key) => key !== "type")!]; break;
          case "unknown": payload.unrecognized = true; break;
          case "wrong type": payload.type = "not_a_control_event"; break;
          case "null": payload[Object.keys(payload).find((key) => key !== "type" && payload[key] !== null)!] = null; break;
          case "empty id": value.eventId = ""; break;
          case "negative time": value.occurredAt = -1; break;
          case "fractional sequence": value.sequence = 1.5; break;
        }
        parity(value, false);
      });
    }
  }

  test("empty goal prose and nullable root reservation remain admitted", () => {
    const event = structuredClone(specimens.find((e) => e.payload.type === "goal_registered")!);
    if (event.payload.type !== "goal_registered") throw new Error("fixture");
    event.payload.goal.objectives = [""];
    event.payload.goal.acceptanceCriteria = [""];
    parity(event, true);
    const root = h.conductor.events().find((e) => e.payload.type === "grant_registered")!;
    parity(root, true);
  });

  test("unknown is not a terminal outcome; succeeded and failed are structurally admitted", () => {
    const event = structuredClone(specimens.find((e) => e.payload.type === "attempt_outcome_committed")!);
    if (event.payload.type !== "attempt_outcome_committed") throw new Error("fixture");
    event.payload.outcome.status = "failed";
    parity(event, true);
    (event.payload.outcome as unknown as Record<string, unknown>).status = "unknown";
    parity(event, false);
  });

  test("duplicate resource entries are structurally valid and semantically rejected", () => {
    const events = structuredClone(h.conductor.events());
    const index = events.findIndex((e) => e.payload.type === "grant_registered" && e.payload.reservation !== null);
    const event = events[index]!;
    if (event.payload.type !== "grant_registered" || !event.payload.reservation) throw new Error("fixture");
    event.payload.reservation.requests = [...event.payload.reservation.requests, structuredClone(event.payload.reservation.requests[0]!)];
    parity(event, true);
    try { replayControlState(rechain(events.slice(0, index + 1)), h.trust); throw new Error("replay accepted duplicate"); }
    catch (error) { expect(error).toBeInstanceOf(AgentFabricError); expect((error as AgentFabricError).code).toBe("AF_INVALID_EVENT"); }
  });
});
