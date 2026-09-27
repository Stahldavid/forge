/** Opt-in real Ollama smoke. Uses a fixture and synthetic approval; never proves owner UI acceptance. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { LocalTaskService } from "../src/forge/agent-fabric/local-task-service.ts";
import type { LocalCodingTaskProposal } from "../src/forge/agent-fabric/local-task-contract.ts";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true }).trim();
}

async function main(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "forge-fabric-ollama-smoke-"));
  try {
    git(root, "init", "-q");
    git(root, "config", "user.name", "Forge Smoke");
    git(root, "config", "user.email", "forge-smoke@example.invalid");
    writeFileSync(join(root, "answer.txt"), "alpha\n");
    git(root, "add", "answer.txt");
    git(root, "commit", "-qm", "smoke fixture");
    const proposal: LocalCodingTaskProposal = {
      schemaVersion: 1, repositoryId: "repo:ollama-smoke", baseCommit: git(root, "rev-parse", "HEAD"),
      goal: "Change answer.txt from alpha to beta and preserve its trailing newline",
      acceptanceCriteria: ["answer.txt contains exactly beta followed by a newline"],
      nonObjectives: ["Do not change any other file"],
      sourcePaths: ["answer.txt"], writablePaths: ["answer.txt"],
      requestedModelTargetId: "target:ollama:local",
      limits: { maximumAttempts: 1, maximumWallClockMs: 120_000, maximumOutputTokens: 768,
        maximumContextBytes: 4_096, maximumPatchBytes: 4_096, expiresAt: Date.now() + 180_000 },
    };
    const service = await LocalTaskService.open(root, async () => "approved");
    try {
      const proposed = await service.propose(proposal);
      await service.review(proposed.taskId);
      let result;
      try {
        result = await service.run(proposed.taskId);
      } catch (error) {
        const artifact = join(root, ".forge", "local", "agent-fabric", "artifacts",
          `${proposed.proposalDigest.slice("sha256:".length)}.model.json`);
        if (existsSync(artifact)) {
          const saved = JSON.parse(readFileSync(artifact, "utf8")) as { text?: string };
          process.stderr.write(`Model text: ${JSON.stringify(saved.text?.slice(0, 3000))}\n`);
        }
        throw error;
      }
      process.stdout.write(`${JSON.stringify({ state: result.state, evidence: result.evidence,
        changedPaths: result.patch?.changedPaths, diffDigest: result.patch?.diffDigest,
        verification: result.patch?.verification, syntheticApproval: true })}\n`);
      if (result.state !== "patch_ready" || result.patch?.verification !== "diff_check_passed" ||
          readFileSync(join(result.patch.worktreeRoot, "answer.txt"), "utf8") !== "beta\n") {
        process.exitCode = 1;
      }
    } finally {
      await service.close();
    }
  } finally {
    const tempRoot = resolve(tmpdir());
    const target = resolve(root);
    if (!target.startsWith(`${tempRoot}${sep}`)) throw new Error("Smoke cleanup target escapes temp directory");
    rmSync(target, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
