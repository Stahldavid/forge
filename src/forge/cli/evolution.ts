import { realpathSync } from "node:fs";
import { LocalEvolutionService } from "../agent-fabric/local-evolution-service.ts";
import type { EvolutionChannel, EvolutionDecisionAction } from "../agent-fabric/local-evolution-registry.ts";

export interface EvolutionCliOptions {
  subcommand: "register" | "evaluate" | "status" | "review" | "load";
  workspaceRoot: string;
  json: boolean;
  manifest?: string;
  versionId?: string;
  action?: EvolutionDecisionAction;
  extensionKey?: string;
  channel?: EvolutionChannel;
}

export async function runEvolutionCommand(options: EvolutionCliOptions): Promise<number> {
  let service: LocalEvolutionService | undefined;
  try {
    service = await LocalEvolutionService.open(realpathSync(options.workspaceRoot));
    const result = options.subcommand === "register"
      ? await service.register(options.manifest!)
      : options.subcommand === "evaluate"
        ? await service.evaluate(options.versionId!)
        : options.subcommand === "status"
          ? await service.status(options.versionId!)
          : options.subcommand === "review"
            ? await service.decide(options.action!, options.versionId!)
            : await service.loadSelected(options.extensionKey!, options.channel!);
    // The CLI loader reports verified metadata. Library callers can consume the verified bytes.
    const output = "artifact" in result ? { versionId: result.versionId,
      extensionKey: result.manifest.extensionKey, artifactBytes: result.artifact.length } : result;
    process.stdout.write(options.json ? `${JSON.stringify({ ok: true, result: output }, null, 2)}\n` :
      `${JSON.stringify(output, null, 2)}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(options.json ? `${JSON.stringify({ ok: false, error: message }, null, 2)}\n` : `error: ${message}\n`);
    return 1;
  } finally { await service?.close(); }
}
