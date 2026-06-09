import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildRuntimeGraph } from "../../src/forge/compiler/runtime-graph/build.ts";
import {
  serializeRuntimeGraphJson,
  serializeRuntimeGraphTs,
  serializeRuntimeRegistryTs,
} from "../../src/forge/compiler/orchestrator/serialize.ts";
import { fixtureSource, fixtureWorkspaceRoot } from "./helpers.ts";

describe("buildRuntimeGraph", () => {
  test("extracts command and action entries", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("commands.ts"),
        fixtureSource("actions.ts"),
      ],
    });

    const runtimeGraph = buildRuntimeGraph(appGraph);

    expect(runtimeGraph.entries).toHaveLength(2);
    expect(runtimeGraph.entries.map((entry) => entry.name).sort()).toEqual([
      "createCheckout",
      "createTicket",
    ]);
    expect(runtimeGraph.entries.every((entry) => entry.moduleId.length > 0)).toBe(
      true,
    );
    expect(runtimeGraph.schemaVersion).toBe("1.0.0");
    expect(runtimeGraph.analyzerVersion).toBe("0.1.0");
  });

  test("warns on duplicate entry names", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("duplicate-a.ts"),
        fixtureSource("duplicate-b.ts"),
      ],
    });

    const runtimeGraph = buildRuntimeGraph(appGraph);

    expect(runtimeGraph.entries).toHaveLength(2);
    const dupWarnings = runtimeGraph.diagnostics.filter(
      (diagnostic) => diagnostic.code === "FORGE_DUP_RUNTIME_ENTRY",
    );
    expect(dupWarnings).toHaveLength(2);
  });

  test("serializes deterministically", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [
        fixtureSource("commands.ts"),
        fixtureSource("actions.ts"),
      ],
    });

    const runtimeGraph = buildRuntimeGraph(appGraph);
    const jsonA = serializeRuntimeGraphJson(runtimeGraph);
    const jsonB = serializeRuntimeGraphJson(buildRuntimeGraph(appGraph));
    const ts = serializeRuntimeGraphTs(runtimeGraph);
    const registry = serializeRuntimeRegistryTs(runtimeGraph);

    expect(jsonA).toBe(jsonB);
    expect(ts).toContain("export const runtimeGraph");
    expect(registry).toContain("export const runtimeRegistry");
    expect(registry).toContain("createTicket");
  });
});
