import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { analyzeRepository, repositoryManifestHash, validateRepositorySnapshot } from "../../src/forge/repository-analysis/analyze.ts";
import { discoverRepository, hashRepositoryFile, scanRepository } from "../../src/forge/repository-analysis/scanner.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import type { RepositorySnapshot } from "../../src/forge/repository-analysis/types.ts";

const directories: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-analyzers-")); directories.push(root);
  for (const [path, source] of Object.entries(files)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), source); }
  return root;
}
afterEach(() => { for (const root of directories.splice(0)) { if (!resolve(root).startsWith(resolve(tmpdir()) + "\\forge-repository-analyzers-") && !resolve(root).startsWith(resolve(tmpdir()) + "/forge-repository-analyzers-")) throw new Error("Unsafe test cleanup"); rmSync(root, { recursive: true, force: true }); } });

const manifest: RepositoryManifest = {
  forgeProtocol: "2.0", kind: "repository",
  components: [
    { id: "web", root: "frontend", adapters: ["vue", "typescript"] },
    { id: "api", root: "backend", adapters: ["java", "spring", "maven", "gradle", "docker"] },
    { id: "infra", root: ".", adapters: ["docker"] },
  ],
  scenario: { composeFiles: ["compose.yaml"], profiles: [] },
};

function pilot(): string {
  return fixture({
    "frontend/package.json": JSON.stringify({ name: "orders-web", dependencies: { vue: "3", axios: "1" } }),
    "frontend/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } }),
    "frontend/src/Orders.vue": '<script setup lang="ts">\r\n// emoji 😀 stays in original offsets\r\nimport Panel from "@/Panel.vue";\r\nimport { useOrders } from "@/useOrders";\r\nconst orders = useOrders();\r\ndefineProps<{title:string}>();\r\n</script>\r\n<template><Panel/><UnknownCard/><component :is="dynamic"/></template>',
    "frontend/src/Panel.vue": "<template><section>orders</section></template>",
    "frontend/src/useOrders.ts": "export function useOrders() { return fetch('/api/orders'); } export function createOrder() { return fetch('/api/orders', { method: 'POST' }); }",
    "frontend/tests/orders.test.ts": "import { useOrders } from '../src/useOrders'; test('orders', () => useOrders());",
    "backend/pom.xml": "<project><modules><module>common</module></modules><dependencies><dependency><groupId>org.springframework</groupId><artifactId>spring-web</artifactId></dependency></dependencies></project>",
    "backend/build.gradle.kts": 'dependencies { implementation("org.junit:junit:4") }',
    "backend/src/OrderController.java": 'package demo;\n@RequestMapping("/api")\npublic class OrderController {\n@GetMapping("/orders")\npublic String listOrders() { return "secret-literal-do-not-emit"; }\n@PostMapping("/orders")\npublic String createOrder() { return listOrders(); }\n}',
    "backend/src/test/OrderControllerTest.java": "package demo; public class OrderControllerTest { @Test public void works() { new OrderController(); } }",
    "backend/Dockerfile": "FROM eclipse-temurin:21 AS builder\nARG PRIVATE_TOKEN=secret-build-value\nCOPY . /app\nFROM eclipse-temurin:21-jre AS runtime\nCOPY --from=builder /app/target/app.jar /app.jar\nENTRYPOINT [\"java\",\"-jar\",\"/app.jar\"]\n",
    "compose.yaml": "services:\n  api:\n    build: ./backend\n    ports: [\"8080:8080\"]\n    environment:\n      PASSWORD: inline-secret-value\n      DB_URL: ${DATABASE_URL}\n    env_file: .env\n    depends_on: [db]\n  db:\n    image: postgres:17\n    volumes: [\"db-data:/var/lib/postgresql/data\"]\nvolumes:\n  db-data: {}\n",
    ".env": "PASSWORD=never-read-env-secret\n",
    ".env.local": "TOKEN=never-read-local-secret\n",
    "private-key.pem": "secret-private-key\n",
  });
}

function node(snapshot: RepositorySnapshot, kind: string, name: string) { return snapshot.nodes.find((item) => item.kind === kind && item.name === name)!; }

describe("repository analyzers", () => {
  test("Vue + Java + Compose produce linked maps without runtime migration or secret payloads", async () => {
    const root = pilot(); const snapshot = await analyzeRepository(root, manifest);
    expect(node(snapshot, "ui-component", "Orders")).toBeDefined();
    const panel = node(snapshot, "ui-component", "Panel"); const orders = node(snapshot, "ui-component", "Orders");
    expect(snapshot.edges.some((edge) => edge.from === orders.id && edge.to === panel.id && edge.kind === "renders")).toBe(true);
    const get = node(snapshot, "endpoint", "GET /api/orders"); const post = node(snapshot, "endpoint", "POST /api/orders");
    expect(get).toBeDefined(); expect(post).toBeDefined();
    const call = node(snapshot, "http-call", "GET /api/orders");
    const routeLink = snapshot.edges.find((edge) => edge.from === call.id && edge.to === get.id);
    expect(routeLink?.evidence.assurance).toBe("inferred"); expect(snapshot.edges.some((edge) => edge.from === call.id && edge.to === post.id)).toBe(false);
    const service = node(snapshot, "container-service", "api");
    expect(snapshot.edges.some((edge) => edge.from === service.id && edge.to === node(snapshot, "component", "api").id && edge.kind === "builds")).toBe(true);
    expect(service.metadata.environmentNames).toEqual(["PASSWORD", "DB_URL"]);
    expect(node(snapshot, "build-stage", "runtime")).toBeDefined(); expect(node(snapshot, "dependency", "org.springframework:spring-web")).toBeDefined();
    const serialized = JSON.stringify(snapshot);
    for (const secret of ["inline-secret-value", "never-read-env-secret", "never-read-local-secret", "secret-private-key", "secret-build-value", "secret-literal-do-not-emit"]) expect(serialized).not.toContain(secret);
    expect(snapshot.coverage.ignoredPaths.some((item) => item.path === ".env" && item.reason === "sensitive")).toBe(true);
    expect(snapshot.nodes.filter((item) => item.kind === "test").length).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(root, ".forge"))).toBe(false);
  });

  test("Vue source coordinates remain original UTF-16 offsets with CRLF and Unicode", async () => {
    const root = pilot(); const snapshot = await analyzeRepository(root, manifest, { write: false });
    const useOrders = snapshot.nodes.find((item) => item.file === "frontend/src/Orders.vue" && item.kind === "import" && item.name === "@/useOrders")!;
    const source = readFileSync(join(root, useOrders.file!), "utf8");
    expect(source.slice(useOrders.location!.start, useOrders.location!.end)).toBe('import { useOrders } from "@/useOrders";');
    expect(useOrders.location!.line).toBe(4);
    expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_VUE_COMPONENT_UNRESOLVED")).toBe(true);
  });

  test("Vue normal script and setup homonyms have distinct global-source identities", async () => {
    const root = fixture({ "Component.vue": '<script lang="ts">const duplicate = 1; export default {};</script><script setup lang="ts">const duplicate = 2;</script><template><div/></template>' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["vue"] }] };
    const snapshot = await analyzeRepository(root, config); const symbols = snapshot.nodes.filter((item) => item.kind === "symbol" && item.name === "duplicate");
    expect(symbols).toHaveLength(2); expect(new Set(symbols.map((item) => item.id)).size).toBe(2); expect(symbols[0].location!.start).not.toBe(symbols[1].location!.start);
  });

  test("TypeScript lexical binding distinguishes homonyms and excludes strings/comments", async () => {
    const root = fixture({ "main.ts": "function work() { return 1; } function outer() { function work() { return 2; } work(); } work(); // work()\nconst literal = 'work()';" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["typescript"] }] };
    const snapshot = await analyzeRepository(root, config);
    const work = snapshot.nodes.filter((item) => item.kind === "symbol" && item.name === "work"); expect(work).toHaveLength(2);
    const references = snapshot.edges.filter((item) => item.kind === "calls" && work.some((symbol) => symbol.id === item.to)); expect(references).toHaveLength(2);
    expect(new Set(references.map((item) => item.to)).size).toBe(2);
    expect(references.every((item) => item.evidence.assurance === "resolved")).toBe(true);
  });

  test("local compiler config inheritance and Vue project references resolve aliases with exact precedence", async () => {
    const root = fixture({
      "tsconfig.base.json": '{"compilerOptions":{"baseUrl":".","paths":{"@/*":["web/*"],"@/special":["missing-special.ts"],"*": ["fallback/*"]}}}',
      "web/tsconfig.json": '{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.node.json"}]}',
      "web/tsconfig.app.json": '{"extends":"../tsconfig.base.json","include":["src/**/*"]}',
      "web/tsconfig.node.json": '{"include":["vite.config.ts"],"compilerOptions":{"paths":{"@/*":["wrong/*"]}}}',
      "web/src/main.ts": "import { helper } from '@/helper'; import '@/special'; helper();",
      "web/helper.ts": "export function helper() { return 1; }",
      "web/special.ts": "export const accidentalFallback = true;",
      "fallback/@/special.ts": "export const otherFallback = true;",
    });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["typescript"] }] };
    const snapshot = await analyzeRepository(root, config);
    const helper = snapshot.nodes.find((item) => item.kind === "symbol" && item.name === "helper")!;
    expect(snapshot.edges.some((item) => item.to === helper.id && item.kind === "calls")).toBe(true);
    expect(snapshot.nodes.find((item) => item.kind === "import" && item.name === "@/special")!.metadata.resolvedFile).toBeUndefined();
    expect(snapshot.coverage.diagnostics.some((item) => item.message.includes("@/special") && item.code === "REPOSITORY_IMPORT_UNRESOLVED")).toBe(true);
  });

  test("Vue conditional templates expose imported components and typed prop/event names", async () => {
    const root = fixture({ "App.vue": '<script setup lang="ts">import Child from "./Child.vue"; defineProps<{visible:boolean}>(); defineEmits(["save"]);</script><template><Child v-if="visible"/><Child v-else/></template>', "Child.vue": "<template><div/></template>" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["vue"] }] };
    const snapshot = await analyzeRepository(root, config);
    expect(snapshot.edges.some((item) => item.kind === "renders" && item.to === node(snapshot, "ui-component", "Child").id)).toBe(true);
    expect(node(snapshot, "declaration", "defineProps").metadata.names).toEqual(["visible"]); expect(node(snapshot, "declaration", "defineEmits").metadata.names).toEqual(["save"]);
  });

  test("Vue TSX and JSX blocks use their declared parser language and preserve source offsets", async () => {
    const root = fixture({ "Typed.vue": '<script lang="tsx">export const view = () => <section title="typed" />;</script>', "JavaScript.vue": '<script lang="jsx">export const view = () => <section title="javascript" />;</script>' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["vue"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.coverage.diagnostics.filter((item) => item.code === "REPOSITORY_TS_PARSE")).toHaveLength(0);
    for (const path of ["Typed.vue", "JavaScript.vue"]) { const symbol = snapshot.nodes.find((item) => item.file === path && item.kind === "symbol" && item.name === "view")!; expect(symbol).toBeDefined(); expect(readFileSync(join(root, path), "utf8").slice(symbol.location!.start, symbol.location!.end)).toContain("<section"); }
  });

  test("Vue external templates and preprocessors are reported without loading external content", async () => {
    const root = fixture({ "External.vue": '<template src="../../outside.html"></template>', "Preprocessor.vue": '<template lang="pug">SecretComponent(secret="secret-pug-value")</template>' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: ".", adapters: ["vue"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_VUE_TEMPLATE_EXTERNAL")).toBe(true); expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_VUE_TEMPLATE_LANGUAGE")).toBe(true); expect(JSON.stringify(snapshot)).not.toContain("secret-pug-value");
  });

  test("discovery assigns Dockerfiles to their Java component and joins continued Docker instructions", async () => {
    const root = fixture({ "backend/pom.xml": "<project/>", "backend/Dockerfile": 'FROM eclipse-temurin:21 AS builder\nCOPY ["app.jar", \\\n "/app.jar"]\nFROM builder AS runtime\n' });
    const proposal = discoverRepository(root); expect(proposal.components.find((item) => item.root === "backend")!.adapters).toContain("docker");
    const snapshot = await analyzeRepository(root, proposal); const copy = node(snapshot, "copy-declaration", "COPY"); expect(copy.metadata.sources).toEqual(["app.jar"]); expect(copy.metadata.destination).toBe("/app.jar"); expect(copy.location!.endLine).toBe(4);
  });

  test("Docker heredoc bodies cannot manufacture build stages or expose shell payloads", async () => {
    const root = fixture({ "Dockerfile": "FROM alpine AS actual\nRUN <<EOF\nFROM imaginary AS fake\nPASSWORD=hidden-heredoc-value\nEOF\nCOPY app /app\n" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "infra", root: ".", adapters: ["docker"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.nodes.filter((item) => item.kind === "build-stage").map((item) => item.name)).toEqual(["actual"]); expect(JSON.stringify(snapshot)).not.toContain("hidden-heredoc-value"); expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_DOCKER_HEREDOC")).toBe(true);
  });

  test("child tsconfig without inheritance cannot silently reuse root aliases", async () => {
    const root = fixture({ "tsconfig.json": '{"compilerOptions":{"paths":{"@/*":["shared/*"]}}}', "web/tsconfig.json": "{}", "web/main.ts": "import '@/target';", "shared/target.ts": "export const shouldNotResolve = 1;" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["typescript"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.edges.some((item) => item.kind === "imports")).toBe(false); expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_IMPORT_UNRESOLVED")).toBe(true);
  });

  test("route parameters match single segments without prefix association", async () => {
    const root = fixture({ "Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders/{id}") public String get() { return "x"; } }', "client.ts": "fetch('/api/orders/123'); fetch('/api/orders/123/details');" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["typescript", "java"] }] };
    const snapshot = await analyzeRepository(root, config); const endpoint = node(snapshot, "endpoint", "GET /api/orders/{id}");
    expect(snapshot.edges.some((item) => item.from === node(snapshot, "http-call", "GET /api/orders/123").id && item.to === endpoint.id)).toBe(true);
    expect(snapshot.edges.some((item) => item.from === node(snapshot, "http-call", "GET /api/orders/123/details").id && item.to === endpoint.id)).toBe(false);
  });

  test("corrupted cached facts are discarded instead of leaking invented symbols into the graph", async () => {
    const root = fixture({ "main.ts": "export function original() { return 1; }" }); const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["typescript"] }] };
    await analyzeRepository(root, config, { write: true }); const cachePath = join(root, ".forge/repository/facts.json"); const cache = JSON.parse(readFileSync(cachePath, "utf8")); cache.files["main.ts"].result.nodes[0].name = "invented"; writeFileSync(cachePath, JSON.stringify(cache));
    const snapshot = await analyzeRepository(root, config); expect(node(snapshot, "symbol", "original")).toBeDefined(); expect(node(snapshot, "symbol", "invented")).toBeUndefined(); expect(snapshot.coverage.reused).toBe(0);
  });

  test("cache reuses unchanged facts and invalidates after local edits, deletes, renames and config changes", async () => {
    const root = pilot(); const first = await analyzeRepository(root, manifest, { write: true });
    const second = await analyzeRepository(root, manifest, { write: true }); expect(second.snapshotId).toBe(first.snapshotId); expect(second.coverage.reused).toBe(first.coverage.found);
    writeFileSync(join(root, "frontend/src/useOrders.ts"), "export function useOrders() { return fetch('/api/changed'); }");
    const third = await analyzeRepository(root, manifest, { write: true }); expect(third.snapshotId).not.toBe(first.snapshotId); expect(third.coverage.reused).toBeLessThan(second.coverage.reused);
    expect(validateRepositorySnapshot(root, first).some((message) => message.includes("Changed source"))).toBe(true);
    renameSync(join(root, "frontend/src/Panel.vue"), join(root, "frontend/src/Renamed.vue"));
    const fourth = await analyzeRepository(root, manifest); expect(fourth.coverage.diagnostics.some((item) => item.code === "REPOSITORY_IMPORT_UNRESOLVED" && item.message.includes("@/Panel"))).toBe(true);
    unlinkSync(join(root, "frontend/src/Renamed.vue")); expect(validateRepositorySnapshot(root, fourth).some((message) => message.includes("Deleted"))).toBe(true);
    writeFileSync(join(root, "frontend/tsconfig.json"), '{"compilerOptions":{"paths":{"@/*":["missing/*"]}}}');
    expect(validateRepositorySnapshot(root, third).some((message) => message.includes("tsconfig"))).toBe(true);
  });

  test("snapshot validation detects new files and canonical root identity", async () => {
    const root = pilot(); const snapshot = await analyzeRepository(root, manifest);
    expect(validateRepositorySnapshot(root, snapshot)).toEqual([]);
    writeFileSync(join(root, "frontend/src/new.ts"), "export const added = 1;");
    expect(validateRepositorySnapshot(root, snapshot).some((message) => message.includes("New source"))).toBe(true);
    const other = pilot(); expect(validateRepositorySnapshot(other, snapshot).some((message) => message.includes("root"))).toBe(true);
  });

  test("HTTP duplicate services remain ambiguous and absolute origins are not falsely linked", async () => {
    const root = pilot(); writeFileSync(join(root, "backend/src/OtherController.java"), '@RequestMapping("/api") public class OtherController { @GetMapping("/orders") public String get() { return "x"; } }');
    writeFileSync(join(root, "frontend/src/remote.ts"), "export const remote = fetch('https://other.invalid/api/orders');");
    const snapshot = await analyzeRepository(root, manifest);
    expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_HTTP_AMBIGUOUS")).toBe(true);
    for (const call of snapshot.nodes.filter((item) => item.kind === "http-call" && item.metadata.method === "GET")) expect(snapshot.edges.some((edge) => edge.from === call.id && snapshot.nodes.some((endpoint) => endpoint.kind === "endpoint" && endpoint.id === edge.to))).toBe(false);
  });

  test("Compose scenarios, profiles and partial overlays affect snapshots without reading env", async () => {
    const root = pilot(); writeFileSync(join(root, "compose.dev.yaml"), 'services:\n  api:\n    ports: ["9090:8080"]\n  debug:\n    image: busybox\n    profiles: [debug]\n');
    const a = await analyzeRepository(root, { ...manifest, scenario: { composeFiles: ["compose.yaml", "compose.dev.yaml"], profiles: [] } });
    const b = await analyzeRepository(root, { ...manifest, scenario: { composeFiles: ["compose.yaml", "compose.dev.yaml"], profiles: ["debug"] } });
    expect(a.snapshotId).not.toBe(b.snapshotId); expect(node(a, "container-service", "debug").metadata.enabled).toBe(false); expect(node(b, "container-service", "debug").metadata.enabled).toBe(true);
    expect(a.coverage.diagnostics.some((item) => item.code === "REPOSITORY_COMPOSE_OVERLAY_PARTIAL")).toBe(true);
    expect(node(a, "container-service", "api").evidence.resolution).toBe("partial");
    expect(JSON.stringify(a)).not.toContain("inline-secret-value");
  });

  test("Compose overlay in another directory preserves first-file build paths and provenance", async () => {
    const root = pilot(); mkdirSync(join(root, "deploy")); writeFileSync(join(root, "deploy/compose.override.yaml"), 'services:\n  api:\n    ports: ["9090:8080"]\n');
    const snapshot = await analyzeRepository(root, { ...manifest, scenario: { composeFiles: ["compose.yaml", "deploy/compose.override.yaml"] } });
    const api = node(snapshot, "container-service", "api"); const dockerfile = snapshot.nodes.find((item) => item.kind === "file" && item.file === "backend/Dockerfile")!;
    expect(snapshot.edges.some((item) => item.from === api.id && item.to === dockerfile.id && item.kind === "builds")).toBe(true);
    expect(api.metadata.composeBaseDirectory).toBe("."); expect((api.metadata.fieldSources as Record<string, string[]>).build).toEqual(["compose.yaml"]);
  });

  test("normalized roots match dot-prefixed components without weakening traversal bounds", async () => {
    const root = fixture({ ".source/main.ts": "export const hiddenRoot = 1;", "frontend/main.ts": "import '../../.source/main';" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "hidden", root: ".source/.", adapters: ["typescript"] }, { id: "web", root: "frontend/.", adapters: ["typescript"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.files[".source/main.ts"].component).toBe("hidden"); expect(snapshot.files["frontend/main.ts"].component).toBe("web");
    expect(snapshot.edges.some((item) => item.kind === "imports")).toBe(false);
  });

  test("Java Maven/Gradle discovery does not require package.json or Git", async () => {
    const root = fixture({ "pom.xml": "<project><modules><module>api</module></modules></project>", "api/build.gradle.kts": 'include(":common")\ndependencies { implementation("org.acme:lib:1") }', "api/src/Main.java": "package example; public class Main { public void run() {} }" });
    const proposal = discoverRepository(root); expect(proposal.components.some((item) => item.adapters.includes("java"))).toBe(true);
    const snapshot = await analyzeRepository(root, proposal); expect(node(snapshot, "symbol", "Main")).toBeDefined(); expect(node(snapshot, "dependency", "org.acme:lib:1")).toBeDefined();
    expect(snapshot.coverage.limitations.some((item) => item.includes("classpath"))).toBe(true); expect(existsSync(join(root, ".git"))).toBe(false);
  });

  test("symlinks and exclusions cannot import sources outside allowed roots", async () => {
    const root = pilot(); const other = fixture({ "outside.ts": "export const escaped = 'outside-secret';" });
    try { symlinkSync(join(other, "outside.ts"), join(root, "frontend/src/link.ts"), "file"); } catch { /* Windows privilege may disallow symlink creation. */ }
    const config = { ...manifest, exclude: ["**/tests/**"] };
    const snapshot = await analyzeRepository(root, config);
    expect(snapshot.files["frontend/tests/orders.test.ts"]).toBeUndefined(); expect(snapshot.files["frontend/src/link.ts"]).toBeUndefined(); expect(JSON.stringify(snapshot)).not.toContain("outside-secret");
    if (existsSync(join(root, "frontend/src/link.ts"))) expect(scanRepository(root, config).ignored.some((item) => item.reason === "symlink")).toBe(true);
  });

  test("cache lock protects previous snapshot and opt-in external cache writes", async () => {
    const root = pilot(); const cache = fixture({});
    const first = await analyzeRepository(root, manifest, { write: true, cacheRoot: cache }); const published = readFileSync(join(cache, "snapshot.json"), "utf8");
    writeFileSync(join(cache, "analysis.lock"), "occupied");
    await expect(analyzeRepository(root, manifest, { write: true, cacheRoot: cache })).rejects.toThrow();
    expect(readFileSync(join(cache, "snapshot.json"), "utf8")).toBe(published); expect(readFileSync(join(cache, "analysis.lock"), "utf8")).toBe("occupied");
    unlinkSync(join(cache, "analysis.lock")); expect(JSON.parse(published).snapshotId).toBe(first.snapshotId); expect(existsSync(join(root, ".forge"))).toBe(false);
  });

  test("invalid Vue/Compose syntax reports coverage errors without leaking parser source snippets", async () => {
    const root = fixture({ "bad.vue": '<script setup>const token = "secret-marker"; </script><template><div></template>', "compose.yaml": "services:\n  api: [\n" });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["vue", "docker"] }] };
    const snapshot = await analyzeRepository(root, config); expect(snapshot.coverage.errors).toBeGreaterThan(0); expect(JSON.stringify(snapshot)).not.toContain("secret-marker");
  });

  test("canonical manifest hash ignores key ordering; source hash matches UTF8 bytes", () => {
    expect(repositoryManifestHash(manifest)).toBe(repositoryManifestHash({ components: manifest.components, scenario: manifest.scenario, kind: "repository", forgeProtocol: "2.0" }));
    expect(hashRepositoryFile("😀\r\n")).toBe(hashRepositoryFile(Buffer.from("😀\r\n", "utf8")));
  });
});
