import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkflowDefinition } from "../../compiler/types/workflow-registry.ts";
import { prepareRuntimeEnvironment } from "../executor.ts";

interface WorkflowStepHandler {
  name: string;
  handler: (ctx: unknown, run: unknown) => unknown | Promise<unknown>;
}

interface ExportedWorkflow {
  __forge?: { kind: string };
  steps?: WorkflowStepHandler[];
}

export async function resolveWorkflowStepHandler(
  workspaceRoot: string,
  workflow: WorkflowDefinition,
  stepName: string,
  mock: boolean,
): Promise<
  | { ok: true; handler: (ctx: unknown, run: unknown) => unknown | Promise<unknown> }
  | { ok: false; error: string }
> {
  await prepareRuntimeEnvironment(workspaceRoot, { mock });

  const absolutePath = join(workspaceRoot, workflow.file);
  const mod = (await import(pathToFileURL(absolutePath).href)) as Record<string, unknown>;
  const exported = mod[workflow.exportName] as ExportedWorkflow | undefined;

  if (!exported || exported.__forge?.kind !== "workflow") {
    return {
      ok: false,
      error: `export '${workflow.exportName}' is not a workflow`,
    };
  }

  const step = exported.steps?.find((candidate) => candidate.name === stepName);
  if (!step || typeof step.handler !== "function") {
    return {
      ok: false,
      error: `step '${stepName}' not found in workflow '${workflow.name}'`,
    };
  }

  return { ok: true, handler: step.handler };
}
