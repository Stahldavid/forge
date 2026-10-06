import { afterEach, expect, spyOn, test } from "bun:test";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { readRepositorySnapshot } from "../../src/forge/repository-analysis/context.ts";
import { prepareFabricRepositoryContext } from "../../src/forge/agent-fabric/repository-context.ts";
import { evaluateRepositoryQuality, repositoryQualitySummary } from "../../src/forge/repository-analysis/quality.ts";
import { selectRepositoryContext } from "../../src/forge/repository-analysis/retrieval.ts";
import { runRepositoryCommand } from "../../src/forge/cli/repository.ts";
import { hasUnknownOption, parseCli } from "../../src/forge/cli/parse.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import * as retrieval from "../../src/forge/repository-analysis/retrieval.ts";

const roots: string[] = [];
function fixture(files: Record<string, string>) { const root = mkdtempSync(join(tmpdir(), "forge-quality-integration-")); roots.push(root); for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); } return root; }
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-quality-integration-")) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });
const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript", "vue", "nuxt"] }, { id: "api", root: "api", adapters: ["java", "spring"] }, { id: "tests", root: "tests", adapters: ["typescript"] }],
  checks: [{ id: "web-types", component: "web", argv: ["node", "-e", "throw new Error('must never execute')"], category: "typecheck", cost: "low" }, { id: "backend", component: "api", argv: ["mvn", "test"], requires: ["java"] }] };
function project() { return fixture({
  "web/utils/seoEnvironment.ts": "export function validateSeoEnvironment() { return true; }",
  "web/nuxt.config.ts": "import { validateSeoEnvironment } from './utils/seoEnvironment'; const seoViolations = validateSeoEnvironment(); export default defineNuxtConfig({ srcDir: '.' });",
  "web/utils/checkout.ts": "export function validateCheckoutPayment() { return true; }",
  "web/services/schedule.ts": "export function scheduleBooking() { return true; }",
  "web/services/http.ts": "export function loadScheduleBooking() { return fetch('/api/schedule'); }",
  "web/components/OrderCard.vue": "<template><div>Order</div></template>",
  "web/pages/orders.vue": "<template><OrderCard/></template>",
  "api/ScheduleApi.java": '@RequestMapping("/api") class ScheduleApi { @GetMapping("/schedule") public String scheduleBooking() { return "ok"; } }',
  "tests/features.test.ts": "import { validateSeoEnvironment as checkSeo } from '../web/utils/seoEnvironment'; import { validateCheckoutPayment } from '../web/utils/checkout'; function seoHelper() { return checkSeo(); } test('unsafe SEO in homologation', () => seoHelper()); test('checkout payment', () => validateCheckoutPayment()); test('unrelated price', () => expect(1).toBe(1));",
  "forge.manifest.json": JSON.stringify(manifest),
}); }

test("case-level test relations follow aliases and helpers without linking sibling cases", async () => {
  const root = project(), snapshot = await analyzeRepository(root, manifest);
  const seo = snapshot.nodes.find(node => node.name === "validateSeoEnvironment" && node.kind === "symbol")!;
  const associated = snapshot.edges.filter(edge => ["test-exercises", "test-references"].includes(edge.kind) && edge.to === seo.id).map(edge => snapshot.nodes.find(node => node.id === edge.from)?.name);
  expect(associated).toEqual(["unsafe SEO in homologation"]);
  expect(snapshot.edges.some(edge => edge.kind === "test-file-depends-on")).toBe(true);
  const worker = await prepareFabricRepositoryContext(root, root, "Corrigir validação SEO em homologação", ["web/utils/seoEnvironment.ts"]);
  expect(worker?.metadata.status).toBe("ready");
  const packet = JSON.parse(worker!.prompt.slice(worker!.prompt.indexOf("\n") + 1));
  expect(packet.nodes.some((node: any) => node.name === "validateSeoEnvironment")).toBe(true);
  expect(packet.nodes.some((node: any) => node.name === "unsafe SEO in homologation")).toBe(true);
  expect(packet.nodes.some((node: any) => node.name === "unrelated price")).toBe(false);
  expect(packet.suggestedCheckIds.some((check: any) => check.id === "backend")).toBe(false);
  expect(packet.quality.runtimeObserved).toBe(false);
  expect(packet.edges.some((edge: any) => edge.metadata.association)).toBe(true);
  expect(packet.nodes.filter((node: any) => node.file === "tests/features.test.ts").every((node: any) => node.access === "read-only")).toBe(true);
});

test("reviewed multi-task quality fixtures report recall, precision, omissions and false associations", async () => {
  const root = project(), snapshot = await analyzeRepository(root, manifest);
  const report = evaluateRepositoryQuality(snapshot, [
    { id: "seo", query: "validateSeoEnvironment", scope: ["web/utils/seoEnvironment.ts"], expectedFiles: ["web/utils/seoEnvironment.ts", "web/nuxt.config.ts", "tests/features.test.ts"], expectedTests: ["unsafe SEO in homologation"], forbiddenTests: ["unrelated price", "checkout payment"] },
    { id: "checkout", query: "validateCheckoutPayment", expectedFiles: ["web/utils/checkout.ts", "tests/features.test.ts"], expectedTests: ["checkout payment"], forbiddenTests: ["unsafe SEO in homologation"] },
    { id: "schedule", query: "agendamento ScheduleApi", expectedFiles: ["api/ScheduleApi.java", "web/services/schedule.ts"] },
    { id: "vue", query: "OrderCard", expectedFiles: ["web/components/OrderCard.vue", "web/pages/orders.vue"] },
    { id: "http", query: "loadScheduleBooking", expectedFiles: ["web/services/http.ts", "api/ScheduleApi.java"] },
  ]);
  expect({ passed: report.passed, failures: report.results.filter(result => !result.passed) }).toEqual({ passed: true, failures: [] }); expect(report.modelExecuted).toBe(false); expect(report.applicationTestsExecuted).toBe(false);
  const failing = evaluateRepositoryQuality(snapshot, [{ id: "missing", query: "SEO", expectedFiles: ["missing.ts"] }]);
  expect(failing.passed).toBe(false); expect(failing.results[0]!.missingFiles).toEqual(["missing.ts"]);
  expect(() => evaluateRepositoryQuality(snapshot, [{ id: "unsafe", query: "SEO", expectedFiles: ["../secret"] }])).toThrow("Invalid");
  expect(() => evaluateRepositoryQuality(snapshot, [{ id: "duplicate", query: "SEO", expectedFiles: ["web/utils/seoEnvironment.ts", "web/utils/seoEnvironment.ts"] }])).toThrow("Invalid");
});

test("partitioned facts and graphs round-trip, reject corrupt parts, reuse only identical clone inputs", async () => {
  const root = project(), snapshot = await analyzeRepository(root, manifest, { write: true, partitionCache: true });
  const cache = join(root, ".forge/repository"), header = JSON.parse(readFileSync(join(cache, "snapshot.json"), "utf8"));
  expect(header.kind).toBe("repository-snapshot-index"); expect(header.parts.every((part: any) => part.component)).toBe(true);
  expect(readRepositorySnapshot(root)?.snapshotId).toBe(snapshot.snapshotId);
  const clone = project(), cloned = await analyzeRepository(clone, manifest, { factsCacheRoot: cache });
  expect(cloned.coverage.reused).toBe(cloned.coverage.found); expect(cloned.root).toBe(clone); expect(cloned.snapshotId).not.toBe(snapshot.snapshotId);
  writeFileSync(join(clone, "web/utils/seoEnvironment.ts"), "export function changedSeoEnvironment() { return false; }");
  const changed = await analyzeRepository(clone, manifest, { factsCacheRoot: cache });
  expect(changed.coverage.reused).toBe(changed.coverage.found - 1); expect(changed.nodes.some(node => node.name === "changedSeoEnvironment")).toBe(true);
  const part = header.parts[0]; writeFileSync(join(cache, part.path), "[]");
  expect(() => readRepositorySnapshot(root)).toThrow("partition");
  const facts = JSON.parse(readFileSync(join(cache, "facts.json"), "utf8")), entry = facts.files["web/utils/seoEnvironment.ts"];
  writeFileSync(join(cache, entry.path), "null");
  expect((await analyzeRepository(root, manifest)).nodes.some(node => node.name === "validateSeoEnvironment")).toBe(true);
});

test("quality CLI is read-only, validates reviewed cases and rejects stale source", async () => {
  const root = project(); await analyzeRepository(root, manifest, { write: true });
  const cases = join(root, "cases.json"); writeFileSync(cases, JSON.stringify([{ id: "seo", query: "validateSeoEnvironment", expectedFiles: ["web/utils/seoEnvironment.ts"] }]));
  expect(hasUnknownOption(["repository", "quality", "--root", root, "--cases", cases, "--json", "--no-delta"])).toBeNull();
  expect(parseCli(["repository", "quality", "--root", root, "--cases", cases, "--json"]).errors).toEqual([]);
  expect(parseCli(["repository", "quality", "--root", root, "--cases", cases, "--write"]).errors.length).toBeGreaterThan(0);
  const report = await runRepositoryCommand({ action: "quality", cwd: root, root, cases, write: false, json: true }); expect(report.exitCode).toBe(0);
  writeFileSync(join(root, "web/utils/seoEnvironment.ts"), "export function different() {return false}");
  expect((await runRepositoryCommand({ action: "quality", cwd: root, root, cases, write: false, json: true })).exitCode).toBe(1);
});

test("quality counts declared local aliases separately from external scoped packages", async () => {
  const root = fixture({ "web/main.ts": "import '@shared/missing'; import '@scope/external';" });
  const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"], analysis: { aliases: { "@shared": "shared" } } }] };
  const snapshot = await analyzeRepository(root, config);
  expect(repositoryQualitySummary(snapshot).unresolvedLocalImports).toBe(1);
  expect(snapshot.nodes.find(node => node.kind === "import" && node.name === "@scope/external")?.metadata.resolutionClassification).toBe("external");
});

test("bounded worker context preserves partial numeric HTTP patterns and their endpoint provenance", async () => {
  const config: RepositoryManifest = { ...manifest, httpClients: [{ id: "$api", component: "web", basePath: "/api", apiComponent: "api" }] };
  const root = fixture({
    "web/services/orders.ts": "export const loadOrder = async (id: number) => { const {$api} = useNuxtApp(); const response = await $api.get(`/orders/${id}`); return response.data; };",
    "api/OrderApi.java": '@RequestMapping("/api") class OrderApi { @GetMapping("/orders/{id}") public String order() { return "ok"; } }',
    "forge.manifest.json": JSON.stringify(config),
  });
  const snapshot = await analyzeRepository(root, config);
  const packet = selectRepositoryContext(snapshot, "loadOrder", { writeScope: ["web/services/orders.ts"], maxChars: 6000 });
  expect(packet.nodes.find(node => node.kind === "http-call")?.metadata.requestPathPattern).toBe("/orders/{id}");
  expect(packet.nodes.find(node => node.kind === "endpoint")?.file).toBe("api/OrderApi.java");
  const relation = packet.edges.find(edge => edge.metadata.pathPatternMatch === true)!;
  expect(relation.metadata.runtimeRoutingVerified).toBe(false);
  expect(relation.evidence.resolution).toBe("partial");
  expect(relation.metadata.requestPathPattern).toBe("/api/orders/{id}");
  expect(repositoryQualitySummary(snapshot).dynamicHttpCalls).toBe(1);
  expect(packet.nodes.filter(node => node.file === "api/OrderApi.java").every(node => node.access === "read-only")).toBe(true);
});

test("packet preparation failure never persists ready quality metadata or leaks exception details", async () => {
  const root = project();
  const selector = spyOn(retrieval, "selectRepositoryContext").mockImplementation(() => { throw new Error("PRIVATE_PACKET_FAILURE_DETAIL"); });
  try {
    const context = await prepareFabricRepositoryContext(root, root, "validateSeoEnvironment", ["web/utils/seoEnvironment.ts"]);
    expect(context?.metadata.status).toBe("unavailable");
    expect(context?.metadata.quality).toBeUndefined();
    expect(context?.prompt).toContain("no map evidence is available");
    expect(JSON.stringify(context)).not.toContain("PRIVATE_PACKET_FAILURE_DETAIL");
  } finally { selector.mockRestore(); }
});
