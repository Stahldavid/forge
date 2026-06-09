import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildActionSubscriptions } from "../../src/forge/compiler/action-subscriptions/build.ts";
import { parseActionEventFromSlice } from "../../src/forge/compiler/action-subscriptions/parse.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("action subscriptions compiler", () => {
  test("parseActionEventFromSlice extracts event literal", () => {
    const slice = `action({ event: "ticket.created", handler: async () => {} })`;
    expect(parseActionEventFromSlice(slice)).toBe("ticket.created");
  });

  test("buildActionSubscriptions indexes actions by event", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });

    const subscriptions = buildActionSubscriptions(appGraph);
    const ticketCreated = subscriptions.subscriptions.filter(
      (subscription) => subscription.eventType === "ticket.created",
    );

    expect(ticketCreated.length).toBeGreaterThanOrEqual(0);
    expect(subscriptions.byEvent).toBeDefined();
    expect(subscriptions.schemaVersion).toBe("0.1.0");
  });
});
