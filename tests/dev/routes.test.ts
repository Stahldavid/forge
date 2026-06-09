import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDevManifest } from "../../src/forge/compiler/dev-manifest/build.ts";
import { buildQueryRegistry } from "../../src/forge/compiler/query-registry/build.ts";
import { buildRuntimeGraph } from "../../src/forge/compiler/runtime-graph/build.ts";
import {
  fixtureSource,
  fixtureWorkspaceRoot,
} from "../runtime-graph/helpers.ts";

describe("buildDevManifest routes", () => {
  test("produces stable routes with semantic paths", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("commands.ts"),
        fixtureSource("actions.ts"),
      ],
    });

    const runtimeGraph = buildRuntimeGraph(appGraph);
    const queryRegistry = buildQueryRegistry(appGraph);
    const manifestA = buildDevManifest(runtimeGraph, queryRegistry, appGraph);
    const manifestB = buildDevManifest(runtimeGraph, queryRegistry, appGraph);

    expect(manifestA.routes).toEqual(manifestB.routes);
    expect(manifestA.schemaVersion).toBe("1.0.0");
    expect(manifestA.analyzerVersion).toBe("0.1.0");

    const createTicket = manifestA.entries.find(
      (entry) => entry.name === "createTicket",
    );
    const createCheckout = manifestA.entries.find(
      (entry) => entry.name === "createCheckout",
    );

    expect(createTicket).toEqual({
      name: "createTicket",
      kind: "command",
      invokePath: "/run/createTicket",
      semanticPath: "/commands/createTicket",
    });
    expect(createCheckout).toEqual({
      name: "createCheckout",
      kind: "action",
      invokePath: "/run/createCheckout",
      semanticPath: "/actions/createCheckout",
    });

    expect(
      manifestA.routes.some(
        (route) =>
          route.method === "POST" &&
          route.path === "/commands/createTicket" &&
          route.purpose === "invoke",
      ),
    ).toBe(true);
    expect(
      manifestA.routes.some(
        (route) =>
          route.method === "POST" &&
          route.path === "/actions/createCheckout" &&
          route.purpose === "invoke",
      ),
    ).toBe(true);
    expect(
      manifestA.routes.some(
        (route) => route.method === "GET" && route.path === "/health",
      ),
    ).toBe(true);
  });
});
