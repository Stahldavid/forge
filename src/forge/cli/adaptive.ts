import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { LocalAdaptiveService } from "../agent-fabric/local-adaptive-service.ts";

export interface AdaptiveCliOptions {
  subcommand: "adaptive-propose" | "adaptive-review" | "adaptive-run" | "adaptive-status";
  workspaceRoot: string;
  json: boolean;
  file?: string;
  taskId?: string;
  channel?: "canary" | "stable";
}

export async function runAdaptiveCommand(options: AdaptiveCliOptions): Promise<number> {
  let service: LocalAdaptiveService | undefined;
  try {
    const root = realpathSync(options.workspaceRoot);
    service = await LocalAdaptiveService.open(root);
    let status;
    if (options.subcommand === "adaptive-propose") {
      if (!options.file) throw new Error("Adaptive proposal requires --file");
      const file = realpathSync(resolve(root, options.file));
      const relation = relative(root, file);
      if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
        throw new Error("Adaptive proposal file must be inside the current repository");
      }
      if (statSync(file).size > 2048) throw new Error("Adaptive proposal file exceeds 2048 bytes");
      status = await service.propose(JSON.parse(readFileSync(file, "utf8")) as unknown, options.channel);
    } else {
      if (!options.taskId) throw new Error("Adaptive run id is required");
      if (options.subcommand === "adaptive-review") status = await service.review(options.taskId);
      else if (options.subcommand === "adaptive-run") {
        const abort = new AbortController();
        const interrupt = () => abort.abort();
        process.once("SIGINT", interrupt);
        process.once("SIGTERM", interrupt);
        try { status = await service.run(options.taskId, abort.signal); }
        finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
      } else status = await service.status(options.taskId);
    }
    process.stdout.write(options.json ? `${JSON.stringify({ ok: true, status }, null, 2)}\n` :
      `${status.id}: ${status.phase}; ${status.journal.childOutcomes} child outcomes; join ${status.journal.joinOutcome?.status ?? "absent"}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(options.json ? `${JSON.stringify({ ok: false, error: message }, null, 2)}\n` : `error: ${message}\n`);
    return 1;
  } finally {
    await service?.close();
  }
}
