import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { collectRuntimeArtifact } from "../../src/forge/repository-analysis/runtime-artifacts.ts";
import { validateRepositoryManifest } from "../../src/forge/repository-manifest/index.ts";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { observeRepositoryRuntime, planRepositoryRuntime, readRuntimeObservation } from "../../src/forge/repository-analysis/runtime-observation.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-runtime-review-")) throw new Error("Unsafe independent fixture cleanup");
    rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge-runtime-review-")); roots.push(root);
  mkdirSync(join(root, "web")); writeFileSync(join(root, "web/main.ts"), "export function orders() { return []; }");
  writeFileSync(join(root, "config.yaml"), "feature: enabled\n");
  writeFileSync(join(root, "emit.mjs"), "import { writeFileSync } from 'node:fs'; writeFileSync('runtime.json', JSON.stringify({facts:[{kind:'runtime-resource',name:'orders',details:{type:'OrderRegistry'}}]}));");
  writeFileSync(join(root, "web/runtime.json"), "ORIGINAL EXPORT MUST STAY UNCHANGED");
  const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"], files: ["main.ts"] }], runtime: { observations: [{ id: "orders", component: "web", commands: [{ argv: [process.execPath, "../emit.mjs"], timeoutMs: 10000 }], artifacts: [{ path: "web/runtime.json", format: "forge-runtime" }] }] } };
  writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
  return { root, manifest };
}
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)])) : value;

test("real runtime execution preserves original exports and invalidates on config outside component globs", async () => {
  const { root, manifest } = fixture();
  const snapshot = await analyzeRepository(root, manifest, { write: false });
  expect(planRepositoryRuntime(snapshot, "fixture").execution).toBe("not-executed");
  expect(existsSync(join(root, ".forge"))).toBe(false);
  const report = await observeRepositoryRuntime(root, manifest, { environmentId: "fixture", write: true });
  expect(report.observations[0]?.status).toBe("completed");
  expect(report.observations[0]?.facts[0]?.name).toBe("orders");
  expect(readFileSync(join(root, "web/runtime.json"), "utf8")).toBe("ORIGINAL EXPORT MUST STAY UNCHANGED");
  expect(readRuntimeObservation(root, snapshot, { environmentId: "fixture" }).reportId).toBe(report.reportId);
  writeFileSync(join(root, "config.yaml"), "feature: changed\n");
  // Static component globs exclude this config, but runtime execution copied it.
  expect((await analyzeRepository(root, manifest, { write: false })).snapshotId).toBe(snapshot.snapshotId);
  expect(() => readRuntimeObservation(root, snapshot, { environmentId: "fixture" })).toThrow();
}, 30000);

test("a rehashed report cannot bypass collector minimization with arbitrary fact details", async () => {
  const { root, manifest } = fixture(), snapshot = await analyzeRepository(root, manifest, { write: false });
  const report = await observeRepositoryRuntime(root, manifest, { environmentId: "fixture", write: true });
  (report.observations[0]!.facts[0]!.details as Record<string, unknown>).authorization = "opaque-private-value";
  const { digest: ignored, ...body } = report;
  report.digest = `sha256:${createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex")}`;
  writeFileSync(join(root, ".forge/repository/runtime-observation.json"), JSON.stringify(report));
  expect(() => readRuntimeObservation(root, snapshot, { environmentId: "fixture" })).toThrow();
}, 30000);

test("a naturally exiting exporter leaves no owned unref'd child alive", async () => {
  const { root, manifest } = fixture();
  writeFileSync(join(root, "emit.mjs"), "import { writeFileSync } from 'node:fs'; import { spawn } from 'node:child_process'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); child.unref(); writeFileSync('runtime.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'child'+child.pid,details:{type:'FixtureChild'}}]}));");
  const report = await observeRepositoryRuntime(root, manifest, { environmentId: "fixture", write: false });
  expect(report.observations[0]?.status).toBe("completed");
  const name = report.observations[0]?.facts[0]?.name ?? "", pid = Number(/^child(\d+)$/.exec(name)?.[1]);
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch (error) { expect((error as NodeJS.ErrnoException).code).toBe("ESRCH"); }
  // Cleanup only the child created by this owned fixture if the assertion fails.
  if (alive) try { process.kill(pid, "SIGKILL"); } catch { }
  expect(alive).toBe(false);
}, 30000);

test.skipIf(process.platform === "win32")("export completion waits for an observed group exit after the signal request", async () => {
  const { root, manifest } = fixture();
  writeFileSync(join(root, "emit.mjs"), [
    "import { writeFileSync } from 'node:fs'; import { spawn } from 'node:child_process';",
    "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); child.unref();",
    "writeFileSync('runtime.json',JSON.stringify({facts:[{kind:'runtime-resource',name:'child'+child.pid,details:{type:'FixtureChild'}}]}));",
  ].join("\n"));
  const originalKill = process.kill; let group: number | undefined, observations = 0;
  process.kill = (pid, signal) => {
    if (pid < 0 && signal === "SIGKILL") group = pid;
    // Model the real kernel race: a successful signal request precedes observed exit.
    if (pid === group && signal === 0 && observations++ < 2) return true;
    return originalKill(pid, signal);
  };
  try {
    const report = await observeRepositoryRuntime(root, manifest, { environmentId: "fixture", write: false });
    expect(report.observations[0]?.status).toBe("completed"); expect(observations).toBeGreaterThanOrEqual(3);
  } finally { process.kill = originalKill; }
}, 30000);

test("runtime collectors discard export credentials, traffic contents and unrelated metadata", () => {
  const credential = "unrelated-confidential-value-123";
  const http = collectRuntimeArtifact("http-trace", JSON.stringify({ log: { entries: [{ request: { method: "GET", url: `https://user:${credential}@test.example/api/orders/123?token=${credential}`, headers: [{ name: "Authorization", value: credential }], postData: { text: credential } }, response: { status: 200, content: { text: credential } } }] } }), "web");
  expect(http.facts).toEqual([{ kind: "http-request", name: "GET /api/orders/{id}", component: "web", details: { method: "GET", path: "/api/orders/{id}", status: 200 } }]);
  const docker = collectRuntimeArtifact("docker-inspect", JSON.stringify([{ Name: "/isolated-web", Config: { Env: [`PASSWORD=${credential}`], Image: `registry/${credential}`, Labels: { "com.docker.compose.service": "web", token: credential } }, State: { Status: "running", Running: true }, NetworkSettings: { Networks: { testnet: { IPAddress: credential } } }, Mounts: [{ Source: credential }] }]), "infra");
  expect(docker.facts[0]?.details).toEqual({ state: "running", running: true, service: "web", networks: ["testnet"] });
  const beans = collectRuntimeArtifact("spring-beans", JSON.stringify({ contexts: { app: { beans: { orderService: { type: "example.OrderService", scope: "singleton", dependencies: ["orderRepository"], resource: credential, password: credential } } } } }), "api");
  expect(beans.facts[0]?.details).toEqual({ type: "example.OrderService", scope: "singleton", dependencies: ["orderRepository"] });
  expect(JSON.stringify([http, docker, beans])).not.toContain(credential);
});

test("runtime exports fail closed on malformed structures and report limited semantics", () => {
  expect(collectRuntimeArtifact("spring-mappings", "{broken", "api").facts).toEqual([]);
  const observed = collectRuntimeArtifact("spring-mappings", JSON.stringify({ contexts: { app: { mappings: { dispatcherServlets: { dispatcherServlet: [{ details: { requestMappingConditions: { patterns: ["/orders/{id}"], methods: ["GET"] } } }] } } } } }), "api");
  expect(observed.facts[0]?.name).toBe("GET /orders/{id}");
  const generated = collectRuntimeArtifact("nuxt-components", "declare module 'vue' { export interface GlobalComponents { OrderCard: typeof import('../components/OrderCard.vue')['default'] } }", "web");
  expect(generated.facts[0]?.name).toBe("OrderCard");
  expect(generated.limitations.join(" ")).toContain("rendering");
});

test("runtime manifest rejects inline credential options before process execution", () => {
  const base = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["typescript"] }] };
  for (const argv of [["tool", "--password", "sensitive"], ["tool", "--api-key=abc"], ["tool", "https://user:password@example.com"]]) {
    const value = { ...base, runtime: { observations: [{ id: "probe", component: "web", commands: [{ argv }], artifacts: [{ path: "exports/trace.json", format: "http-trace" }] }] } };
    expect(validateRepositoryManifest(value).manifest).toBeNull();
  }
});
