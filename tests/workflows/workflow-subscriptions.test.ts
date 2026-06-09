import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  buildWorkflowRegistry,
  buildWorkflowSubscriptions,
} from "../../src/forge/compiler/workflow-registry/build.ts";
import { buildAppGraph } from "../../src/forge/compiler/app-graph/build.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow subscriptions compiler", () => {
  test("buildWorkflowSubscriptions indexes workflows by event", async () => {
    const appGraph = await buildAppGraph({
      workspaceRoot: (await import("../data-graph/helpers.ts")).fixtureWorkspaceRoot(),
      sources: [],
    });
    const registry = buildWorkflowRegistry(appGraph);
    const subscriptions = buildWorkflowSubscriptions(registry);
    expect(subscriptions.byEvent).toBeDefined();
    expect(subscriptions.schemaVersion).toBe("0.1.0");
  });

  test("generated workflowSubscriptions maps ticket.created", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-subs");
    writeTriageWorkflow(workflowsDir);

    try {
      expect((await run(defaultGenerateOptions(workspace))).exitCode).toBe(0);

      const subscriptions = JSON.parse(
        stripDeterministicHeader(
          await Bun.file(join(workspace, GENERATED_DIR, "workflowSubscriptions.json")).text(),
        ),
      );

      expect(subscriptions.byEvent["ticket.created"]).toHaveLength(1);
      expect(subscriptions.byEvent["ticket.created"][0].workflowName).toBe(
        "triageTicketWorkflow",
      );
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
