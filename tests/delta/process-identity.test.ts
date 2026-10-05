import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { processStartTimeMs, pidWasReused } from "../../src/forge/delta/process-identity.ts";

test("current live process is not mistaken for a reused PID", () => {
  const start = processStartTimeMs(process.pid);
  expect(start).not.toBeNull(); expect(start!).toBeLessThanOrEqual(Date.now() + 1000);
  expect(pidWasReused(process.pid, new Date().toISOString())).toBe(false);
  expect(pidWasReused(process.pid, "2000-01-01T00:00:00Z")).toBe(true);
});

test.skipIf(process.platform === "win32")("POSIX process identity survives different ps and Bun test timezones", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-process-identity-zone-"));
  try {
    const realPs = execFileSync("which", ["ps"], { encoding: "utf8" }).trim();
    // Emulate a host whose default ps timezone differs from Bun test's UTC.
    // An explicit TZ from the identity implementation must take precedence.
    const wrapper = join(root, "ps");
    writeFileSync(wrapper, '#!/bin/sh\nTZ="${TZ:-Pacific/Kiritimati}" exec ' + JSON.stringify(realPs) + ' "$@"\n');
    chmodSync(wrapper, 0o755);
    const childTest = join(root, "timezone.test.ts");
    writeFileSync(childTest, `import {expect,test} from "bun:test";
import {processStartTimeMs,pidWasReused} from ${JSON.stringify(resolve("src/forge/delta/process-identity.ts"))};
test("actual live PID retains its lease",()=>{
const start=processStartTimeMs(process.pid);
expect(start).not.toBeNull();
expect(Math.abs(Date.now()-start!)).toBeLessThan(10000);
expect(pidWasReused(process.pid,new Date().toISOString())).toBe(false);
expect(pidWasReused(process.pid,"2000-01-01T00:00:00Z")).toBe(true);
});\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${root}${delimiter}${process.env.PATH ?? ""}` }; delete env.TZ;
    const result = spawnSync(process.execPath, ["test", childTest], { env, encoding: "utf8", timeout: 20000, windowsHide: true });
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
