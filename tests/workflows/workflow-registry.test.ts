import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { run } from "../../src/forge/compiler/orchestrator/run.ts";
import {
  parseWorkflowStepNamesFromSlice,
  parseWorkflowTriggerFromSlice,
} from "../../src/forge/compiler/workflow-registry/parse.ts";
import { GENERATED_DIR } from "../../src/forge/compiler/emitter/constants.ts";
import { stripDeterministicHeader } from "../../src/forge/compiler/primitives/header.ts";
import {
  cleanupWorkspace,
  defaultGenerateOptions,
  scaffoldWorkflowWorkspace,
  writeTriageWorkflow,
} from "./helpers.ts";

describe("workflow registry compiler", () => {
  test("parseWorkflowTriggerFromSlice extracts trigger event", () => {
    const slice = `workflow({ trigger: event("ticket.created"), steps: [] })`;
    expect(parseWorkflowTriggerFromSlice(slice)).toBe("ticket.created");
  });

  test("parseWorkflowStepNamesFromSlice extracts step names in order", () => {
    const slice = `
      workflow({
        steps: [
          step("loadTicket", async () => {}),
          step("triageWithAI", async () => {}),
        ],
      })
    `;
    expect(parseWorkflowStepNamesFromSlice(slice)).toEqual([
      "loadTicket",
      "triageWithAI",
    ]);
  });

  test("buildWorkflowRegistry emits workflowRegistry.json", async () => {
    const { workspace, workflowsDir } = scaffoldWorkflowWorkspace("wf-registry");
    writeTriageWorkflow(workflowsDir);

    try {
      expect((await run(defaultGenerateOptions(workspace))).exitCode).toBe(0);

      const registry = JSON.parse(
        stripDeterministicHeader(
          await Bun.file(join(workspace, GENERATED_DIR, "workflowRegistry.json")).text(),
        ),
      );

      const triage = registry.workflows.find(
        (workflow: { name: string }) => workflow.name === "triageTicketWorkflow",
      );
      expect(triage.triggerEventType).toBe("ticket.created");
      expect(triage.steps.map((step: { name: string }) => step.name)).toEqual([
        "loadTicket",
        "triageWithAI",
        "captureAnalytics",
      ]);
    } finally {
      cleanupWorkspace(workspace);
    }
  });
});
