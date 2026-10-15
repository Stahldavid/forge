import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Bun 1.3.14 JSON mode exits 1 even for moderate findings with --audit-level=high.
// Preserve its complete report and apply the existing npm high threshold explicitly.
export function evaluateBunAudit(result) {
  const report = { schema: "forge.bun-lock-audit.v1", threshold: "high", ok: false,
    toolExitCode: result.status ?? null, advisories: null,
    severityCounts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } };
  try {
    if (result.error) throw new Error(`Bun audit execution failed: ${result.error.code ?? result.error.message ?? "unknown"}`);
    if (result.signal) throw new Error(`Bun audit terminated by ${result.signal}`);
    if (![0, 1].includes(result.status)) throw new Error(`Unexpected Bun audit exit: ${result.status}`);
    const data = JSON.parse(result.stdout);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid Bun advisory map");
    report.advisories = data;
    const diagnostics = String(result.stderr ?? "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    // The pinned Bun version writes its banner to stderr even for a complete audit.
    if (diagnostics.some(line => !/^bun audit v[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-zA-Z0-9.-]+)?(?: \([a-f0-9]+\))?$/.test(line))) {
      throw new Error("Bun audit emitted unexpected diagnostics; completeness is unverified");
    }
    let count = 0;
    for (const findings of Object.values(data)) {
      if (!Array.isArray(findings)) throw new Error("Invalid Bun advisory list");
      for (const finding of findings) {
        if (!finding || typeof finding !== "object" || Array.isArray(finding)
          || !Object.hasOwn(report.severityCounts, finding.severity)) throw new Error("Unknown Bun advisory severity/schema");
        report.severityCounts[finding.severity]++;
        count++;
      }
    }
    if (result.status === 1 && count === 0) throw new Error("Bun audit failed without advisories");
    report.ok = report.severityCounts.high === 0 && report.severityCounts.critical === 0;
  } catch (error) {
    report.error = error.message;
    report.rawOutput = result.stdout ?? "";
    report.stderr = result.stderr ?? "";
  }
  return report;
}

export function runBunAudit(spawn = spawnSync) {
  return evaluateBunAudit(spawn("bun", ["audit", "--json"], {
    encoding: "utf8", timeout: 120000, maxBuffer: 32 * 1024 * 1024, windowsHide: true,
  }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = runBunAudit();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 1;
}
