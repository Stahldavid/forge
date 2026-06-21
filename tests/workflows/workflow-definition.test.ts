import { describe, expect, test } from "bun:test";
import { event, step, workflow } from "../../src/forge/server.ts";

describe("workflow definition", () => {
  test("marks workflow exports for the runtime step resolver", () => {
    const definition = workflow({
      trigger: event("incident.reported"),
      steps: [
        step("loadIncident", async () => ({ ok: true })),
      ],
    });

    expect(definition.__forge).toEqual({ kind: "workflow" });
    expect(definition.steps?.[0]?.name).toBe("loadIncident");
  });
});
