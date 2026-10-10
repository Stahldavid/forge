import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { criticalFabricTests, criticalGateTestPattern, assertCriticalGateCoverage, assertCriticalGateResults } from "./ci-test-policy.mjs";
// Never silently skip missing critical tests after a rename.
for (const path of [...criticalFabricTests, "tests/agent-fabric/program-v2.test.ts"]) if (!existsSync(path)) throw new Error(`Missing critical Fabric test: ${path}`);
for (const path of criticalFabricTests) if (!/\btest\(\s*["']/.test(readFileSync(path, "utf8"))) throw new Error(`Empty critical Fabric test: ${path}`);
assertCriticalGateCoverage(readFileSync("tests/agent-fabric/program-v2.test.ts", "utf8"));
const result = spawnSync("bun", ["test", ...criticalFabricTests, "--timeout", "120000"], { stdio: "inherit", windowsHide: true });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
const gates = spawnSync("bun", ["test", "tests/agent-fabric/program-v2.test.ts", "--test-name-pattern", criticalGateTestPattern, "--timeout", "120000"], { encoding: "utf8", maxBuffer: 1024 * 1024, windowsHide: true });
if (gates.error) throw gates.error;
process.stdout.write(gates.stdout ?? ""); process.stderr.write(gates.stderr ?? "");
if (gates.status === 0) assertCriticalGateResults(`${gates.stdout ?? ""}\n${gates.stderr ?? ""}`);
process.exit(gates.status ?? 1);
