import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

// Spawning `node bin/forge.mjs` pays a full tsx transpile of the Forge source
// tree on every cold cache. tsx caches transforms under os.tmpdir()/tsx-<user>,
// but the strict TestGraph chunk runner redirects TMP/TEMP/TMPDIR to a throwaway
// per-chunk directory, so isolated node-compat tests never reuse it. Pin the
// spawned CLI's temp dir to a stable, repo-local cache so the first spawn warms
// the transpile cache and every later spawn (across chunks/runs) reuses it.
// node_modules/.cache is git-ignored and intentionally shared only by these
// spawned CLI subprocesses, so this adds no untracked-file noise.
export const TSX_CLI_CACHE_DIR = join(process.cwd(), "node_modules", ".cache", "forge-tsx-cli");

export function nodeForgeSpawnEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  mkdirSync(TSX_CLI_CACHE_DIR, { recursive: true });
  return {
    ...process.env,
    TMP: TSX_CLI_CACHE_DIR,
    TEMP: TSX_CLI_CACHE_DIR,
    TMPDIR: TSX_CLI_CACHE_DIR,
    ...extra,
  };
}

export async function runNodeForge(
  args: string[],
  options: { cwd?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["node", join(process.cwd(), "bin", "forge.mjs"), ...args], {
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
    env: nodeForgeSpawnEnv(),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, stdout, stderr };
}

export async function runNodeForgeUntilOutput(
  args: string[],
  options: { cwd: string; match: string; timeoutMs: number },
): Promise<{ stdout: string; stderr: string; matched: boolean; timedOut: boolean }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [join(process.cwd(), "bin", "forge.mjs"), ...args], {
      cwd: options.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: nodeForgeSpawnEnv(),
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let pendingResult: { stdout: string; stderr: string; matched: boolean; timedOut: boolean } | null = null;

    function killProcessTree(): void {
      if (proc.killed) {
        return;
      }
      if (process.platform === "win32" && proc.pid) {
        spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], {
          windowsHide: true,
          stdio: "ignore",
        });
        return;
      }
      proc.kill();
    }

    function finish(matched: boolean): void {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      pendingResult = { stdout, stderr, matched, timedOut };
      killProcessTree();
    }

    function collect(chunk: Buffer, target: "stdout" | "stderr"): void {
      if (target === "stdout") {
        stdout += chunk.toString();
      } else {
        stderr += chunk.toString();
      }
      if (`${stdout}\n${stderr}`.includes(options.match)) {
        finish(true);
      }
    }

    const timer = setTimeout(() => {
      timedOut = true;
      finish(false);
    }, options.timeoutMs);

    proc.stdout?.on("data", (chunk) => collect(chunk, "stdout"));
    proc.stderr?.on("data", (chunk) => collect(chunk, "stderr"));
    proc.on("error", (error) => {
      stderr += error.message;
      finish(false);
    });
    proc.on("close", () => {
      if (!settled) {
        finish(`${stdout}\n${stderr}`.includes(options.match));
      }
      resolve(pendingResult ?? {
        stdout,
        stderr,
        matched: `${stdout}\n${stderr}`.includes(options.match),
        timedOut,
      });
    });
  });
}
