import { describe, expect, test } from "bun:test";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { buildDataGraph } from "../../src/forge/compiler/data-graph/build.ts";
import { buildSqlPlan } from "../../src/forge/compiler/data-graph/sql/ddl.ts";
import { createMemoryAdapter } from "../../src/forge/runtime/db/memory-adapter.ts";
import { applyMigrations } from "../../src/forge/runtime/db/migrate.ts";
import { createTelemetryContext } from "../../src/forge/runtime/telemetry/context.ts";
import { createAiContext } from "../../src/forge/runtime/ai/context.ts";
import { createSecretsContext } from "../../src/forge/runtime/secrets/create-context.ts";
import { enqueueMockAiResponse, resetMockAiQueue } from "../../src/forge/runtime/ai/mock.ts";
import { fixtureWorkspaceRoot } from "../data-graph/helpers.ts";

describe("ai telemetry", () => {
  test("records generation started/completed and usage without prompt body", async () => {
    const adapter = createMemoryAdapter();
    const appGraph = await buildAppGraph({
      workspaceRoot: fixtureWorkspaceRoot(),
      sources: [],
    });
    const plan = buildSqlPlan(buildDataGraph(appGraph));
    await applyMigrations(adapter, plan);

    resetMockAiQueue();
    enqueueMockAiResponse({ text: "done", usage: { totalTokens: 20 } });

    const tx = await adapter.begin();
    const telemetry = createTelemetryContext({
      adapter,
      tx,
      traceId: "trace-ai-1",
      runtime: { kind: "workflow", name: "triage" },
      bufferInTransaction: false,
    });

    const secrets = createSecretsContext({
      store: {
        loadedFiles: [],
        resolve: () => undefined,
        snapshot: () => ({}),
      },
      registryNames: new Set(),
      runtimeKind: "workflow",
    });

    const ai = createAiContext({
      secrets,
      telemetry,
      runtimeKind: "workflow",
      mockAi: true,
    });

    await ai.generateText({
      provider: "openai",
      model: "gpt-4o-mini",
      prompt: "secret prompt text",
      purpose: "ticket_triage",
    });

    const rows = await adapter.query(
      `SELECT payload FROM _forge_telemetry_events WHERE trace_id = $1`,
      ["trace-ai-1"],
    );

    const events = rows.rows.map((row) => {
      const payload =
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      return payload?.event?.name as string | undefined;
    });

    expect(events).toContain("forge.ai.generation.started");
    expect(events).toContain("forge.ai.generation.completed");
    expect(events).toContain("forge.ai.usage");

    const payloads = rows.rows.map((row) => JSON.stringify(row.payload));
    expect(payloads.some((p) => p.includes("secret prompt text"))).toBe(false);
  });
});
