import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { LocalTaskService } from "../agent-fabric/local-task-service.ts";

export interface FabricCliOptions {
  subcommand: "capabilities" | "propose" | "status" | "review" | "run" | "review-result";
  workspaceRoot: string;
  json: boolean;
  file?: string;
  taskId?: string;
}

export async function runFabricCommand(options: FabricCliOptions): Promise<number> {
  if (options.subcommand === "capabilities") {
    const result = {
      ok: true, schemaVersion: 1, runtime: "local-pilot",
      proposal: true, ownerReview: true, durableStatus: true,
      codingWorker: true, consequentialEffects: false,
      mcpTaskMutation: false, nativeCodexHookProofRequired: true,
    };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` :
      "Agent Fabric local pilot: proposal, owner review, bounded Ollama coding, and durable status are available.\n");
    return 0;
  }

  let service: LocalTaskService | undefined;
  try {
    const repositoryRoot = realpathSync(options.workspaceRoot);
    let proposal: unknown;
    if (options.subcommand === "propose") {
      if (!options.file) throw new Error("A proposal file is required");
      const file = realpathSync(resolve(repositoryRoot, options.file));
      const relation = relative(repositoryRoot, file);
      if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
        throw new Error("Proposal file must be inside the current repository");
      }
      if (statSync(file).size > 32 * 1024) throw new Error("Proposal file exceeds 32 KiB");
      proposal = JSON.parse(readFileSync(file, "utf8")) as unknown;
    }
    service = await LocalTaskService.open(repositoryRoot);
    const status = options.subcommand === "propose"
      ? await service.propose(proposal)
      : options.subcommand === "review"
        ? await service.review(options.taskId ?? "")
        : options.subcommand === "run"
          ? await service.run(options.taskId ?? "")
          : options.subcommand === "review-result"
            ? await service.reviewResult(options.taskId ?? "")
          : await service.status(options.taskId ?? "");
    process.stdout.write(options.json ? `${JSON.stringify({ ok: true, status }, null, 2)}\n` :
      `${status.taskId}: ${status.state}; execution ${status.canStart ? "available" : "not available"}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(options.json ? `${JSON.stringify({ ok: false, error: message }, null, 2)}\n` : `error: ${message}\n`);
    return 1;
  } finally {
    await service?.close();
  }
}
