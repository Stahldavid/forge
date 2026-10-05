import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeCodexHookRunner } from "../../src/forge/agent-memory/hook-runner.ts";

test("hook probe retains subprocess launch/timeout diagnostics instead of unknown exit", async () => {
  const root = mkdtempSync(join(tmpdir(), "forge-hook-probe-diagnostic-"));
  try {
    const directory = join(root, ".forge", "agent");
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "codex-hook.mjs"), "setTimeout(() => process.exit(0), 10000);\n");
    const probe = await probeCodexHookRunner(root, { maxDurationMs: 1, stdinHangBudgetMs: 1 });
    expect(probe.ok).toBe(false);
    // Its configured subprocess deadline is 1001 ms; it must not fire early.
    expect(probe.durationMs).toBeGreaterThanOrEqual(900);
    expect(probe.exitCode).toBeNull();
    expect(probe.error).toBeDefined();
    expect(probe.error).not.toBe("hook runner exited with code unknown");
    expect(probe.error).toMatch(/ETIMEDOUT|timed out|signal/iu);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 10000);
