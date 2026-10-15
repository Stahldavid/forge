import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import Ajv from "ajv/dist/2020.js";
import { validateRepositoryManifest } from "../../src/forge/repository-manifest/index.ts";
import { collectRuntimeArtifact, validateRuntimeFact, isRuntimeArtifactLimitation, RUNTIME_ARTIFACT_MAX_BYTES } from "../../src/forge/repository-analysis/runtime-artifacts.ts";

const collect = (format: Parameters<typeof collectRuntimeArtifact>[0], data: unknown) => collectRuntimeArtifact(format, typeof data === "string" ? data : JSON.stringify(data), "app");
const manifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["nuxt"] }], runtime: { observations: [{ id: "prepare", component: "app", commands: [{ argv: ["node", "prepare.mjs"], timeoutMs: 30000 }], artifacts: [{ path: ".nuxt/components.d.ts", format: "nuxt-components" }] }] } };
test("runtime declaration is bounded and compatible with repository schema", () => {
  const validate = new Ajv({ strict: false }).compile(JSON.parse(readFileSync("schemas/forge-manifest.schema.json", "utf8")));
  expect(validate(manifest)).toBe(true);
  expect(validateRepositoryManifest(manifest).manifest).not.toBeNull();
  for (const changes of [{ component: "missing" }, { commands: [{ argv: [] }] }, { commands: [{ argv: ["node", "--token", "sensitive"] }] }, { commands: [{ argv: ["node\n"] }] }, { commands: [{ argv: ["node"], timeoutMs: 120001 }] }, { artifacts: [{ path: "../escape", format: "nuxt-components" }] }, { artifacts: [{ path: "nested/.env", format: "nuxt-components" }] }, { artifacts: [{ path: "output.json", format: "unknown" }] }]) {
    expect(validateRepositoryManifest({ ...manifest, runtime: { observations: [{ ...manifest.runtime.observations[0], ...changes }] } }).manifest).toBeNull();
  }
  expect(validateRepositoryManifest({ ...manifest, runtime: { observations: Array(33).fill(manifest.runtime.observations[0]) } }).manifest).toBeNull();
  expect(validate({ ...manifest, runtime: { observations: [{ ...manifest.runtime.observations[0], commands: [{ argv: ["node"], timeoutMs: 99 }] }] } })).toBe(false);
});
test("generated Nuxt declarations expose local resources and aliases without executing source", () => {
  const components = collect("nuxt-components", `declare module 'vue' { export interface GlobalComponents { 'ProductCard': typeof import("../components/ProductCard.vue")['default']; External: typeof import("vue")['Component']; Bad: typeof import("C:/private/Item.vue")['default']; } }`);
  expect(components.facts).toEqual([{ kind: "nuxt-component", name: "ProductCard", component: "app", details: { sourcePath: "../components/ProductCard.vue" } }]);
  const imports = collect("nuxt-imports", `export { useCatalog, internal as useInternal } from '../composables/catalog.ts'; export { ref } from 'vue'; declare global { const useOrders: typeof import('../composables/orders.ts')['useOrders'] }`);
  expect(imports.facts.map(f => f.name)).toEqual(["useCatalog", "useInternal", "useOrders"]);
  expect(imports.facts[1]!.details.exportName).toBe("internal");
  expect(components.limitations.join()).toContain("not observed");
});
test("Nuxt generated imports accept extensionless relative declarations only", () => {
  const result = collect("nuxt-imports", `declare global { const useCart: typeof import('../composables/useCart')['useCart'] }; export { useOrder as useCheckout } from '../composables/useOrder'; export { ref } from 'vue'; export { useNuxtApp } from '#app'; export { bad } from '../composables/../../private'; export { style } from '../assets/style.css';`);
  expect(result.facts.map(f => f.name)).toEqual(["useCart", "useCheckout"]);
  expect(result.facts[0]!.details.sourcePath).toBe("../composables/useCart");
  expect(result.facts[1]!.details.exportName).toBe("useOrder");
  expect(result.facts.every(fact => validateRuntimeFact(fact, "app"))).toBe(true);
  expect(result.limitations.every(isRuntimeArtifactLimitation)).toBe(true);
  expect(result.limitations.join()).toContain("virtual alias");
});
test("Spring Actuator and OpenAPI exports produce environment registration facts", () => {
  const mappings = collect("spring-mappings", { contexts: { application: { mappings: { dispatcherServlets: { dispatcherServlet: [{ handler: "do-not-persist-source", details: { requestMappingConditions: { patterns: ["/rooms/{id}"], methods: ["GET", "POST"] } } }, { details: { requestMappingConditions: { patterns: ["/wildcard"], methods: [] } } }] } } } } });
  expect(mappings.facts.map(f => f.name)).toEqual(["GET /rooms/{id}", "POST /rooms/{id}"]);
  expect(JSON.stringify(mappings)).not.toContain("do-not-persist-source");
  expect(collect("spring-mappings", { openapi: "3.0.0", paths: { "/rooms": { get: { description: "secret" }, post: {} } } }).facts.map(f => f.name)).toEqual(["GET /rooms", "POST /rooms"]);
  const beans = collect("spring-beans", { contexts: { application: { beans: { roomController: { type: "com.example.RoomController", scope: "singleton", dependencies: ["roomService"], resource: "private-file-path", injectedSecret: "PRIVATE" } } } } });
  expect(beans.facts[0]!.details).toEqual({ type: "com.example.RoomController", scope: "singleton", dependencies: ["roomService"] });
  expect(JSON.stringify(beans)).not.toContain("PRIVATE");
});
test("Docker collector drops credentials, image, mounts, other labels and network addresses", () => {
  const result = collect("docker-inspect", [{ Name: "/store-dev", State: { Status: "running", Running: true, Error: "PRIVATE" }, Config: { Env: ["API_KEY=PRIVATE"], Image: "private-image", Labels: { "com.docker.compose.service": "store", "other": "PRIVATE" } }, Mounts: [{ Source: "PRIVATE" }], NetworkSettings: { Networks: { app_default: { IPAddress: "PRIVATE" } } } }]);
  expect(result.facts).toEqual([{ kind: "docker-container", name: "store-dev", component: "app", details: { state: "running", running: true, service: "store", networks: ["app_default"] } }]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).not.toContain("private-image");
});
test("HAR and trace collector retains sanitized methods, paths and valid status only", () => {
  const result = collect("http-trace", { log: { entries: [{ request: { method: "get", url: "https://user:PRIVATE@private.example/api/rooms/123?token=PRIVATE", headers: [{ value: "PRIVATE" }], postData: { text: "PRIVATE" } }, response: { status: 200, content: { text: "PRIVATE" } } }] } });
  expect(result.facts).toEqual([{ kind: "http-request", name: "GET /api/rooms/{id}", component: "app", details: { method: "GET", path: "/api/rooms/{id}", status: 200 } }]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(JSON.stringify(result)).not.toContain("private.example");
  expect(collect("http-trace", [{ method: "POST", path: "/rooms", status: 999 }]).facts[0]!.details).toEqual({ method: "POST", path: "/rooms" });
  expect(collect("http-trace", [{ method: "GET", path: "/api/token/PRIVATE" }]).facts).toEqual([]);
});
test("portable facts permit selected structural fields and supported kinds only", () => {
  const result = collect("forge-runtime", { facts: [{ kind: "runtime-resource", name: "catalog", component: "wrong", details: { type: "Catalog", sourcePath: "src/catalog.ts", secret: "PRIVATE", message: "PRIVATE", arbitrary: "PRIVATE", dependencies: ["storage", "my_secret_value"] } }, { kind: "unsupported", name: "ignored", details: {} }] });
  expect(result.facts).toEqual([{ kind: "runtime-resource", name: "catalog", component: "app", details: { type: "Catalog", sourcePath: "src/catalog.ts", dependencies: ["storage"] } }]);
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
test("collector bounds bytes, depth and facts and reports failures without raw data", () => {
  expect(collect("spring-beans", "PRIVATE invalid json").limitations).toEqual(["Runtime artifact is malformed or exceeds structural bounds"]);
  expect(collect("forge-runtime", "x".repeat(RUNTIME_ARTIFACT_MAX_BYTES + 1)).facts).toEqual([]);
  expect(collect("nuxt-components", "x".repeat(RUNTIME_ARTIFACT_MAX_BYTES)).facts).toEqual([]);
  let deep: unknown = {};
  for (let n = 0; n < 30; n++) deep = { nested: deep };
  expect(collect("spring-beans", deep).limitations).toEqual(["Runtime artifact is malformed or exceeds structural bounds"]);
  const result = collect("forge-runtime", { facts: Array.from({ length: 2200 }, (_, n) => ({ kind: "runtime-resource", name: `resource${n}`, details: {} })) });
  expect(result.facts.length).toBe(2000);
  expect(result.limitations.join()).toContain("truncated");
});

test("saved runtime facts and limitations reject injected fields independently of report hashes", () => {
  const valid = [
    { kind: "nuxt-component", name: "RoomCard", details: { sourcePath: "../components/RoomCard.vue" } },
    { kind: "nuxt-import", name: "useRoom", details: { sourcePath: "../composables/room.ts", exportName: "useRoom" } },
    { kind: "spring-bean", name: "roomService", details: { type: "org.example.RoomService", dependencies: ["database"] } },
    { kind: "spring-route", name: "GET /rooms/{id}", details: { method: "GET", path: "/rooms/{id}" } },
    { kind: "docker-container", name: "store", details: { running: true, state: "running", service: "store", networks: ["local"] } },
    { kind: "http-request", name: "GET /rooms/{id}", details: { method: "GET", path: "/rooms/{id}", status: 200 } },
    { kind: "runtime-resource", name: "catalog", details: { type: "Catalog" } },
  ].map(fact => ({ ...fact, component: "app" }));
  for (const fact of valid) {
    expect(validateRuntimeFact(fact, "app")).toBe(true);
    expect(validateRuntimeFact({ ...fact, details: { ...fact.details, authorization: "PRIVATE" } }, "app")).toBe(false);
    expect(validateRuntimeFact({ ...fact, arbitrary: "PRIVATE" }, "app")).toBe(false);
    expect(validateRuntimeFact(fact, "other")).toBe(false);
  }
  expect(validateRuntimeFact({ ...valid[5], details: { method: "GET", path: "/rooms/123", status: 200 } }, "app")).toBe(false);
  expect(validateRuntimeFact({ ...valid[5], name: "GET /different" }, "app")).toBe(false);
  expect(validateRuntimeFact({ ...valid[5], details: { method: "get", path: "/rooms/{id}" } }, "app")).toBe(false);
  expect(validateRuntimeFact({ ...valid[0], details: { sourcePath: "C:/private/RoomCard.vue" } }, "app")).toBe(false);
  expect(validateRuntimeFact({ ...valid[0], kind: "__proto__" }, "app")).toBe(false);
  expect(isRuntimeArtifactLimitation("PRIVATE arbitrary raw diagnostic")).toBe(false);
  for (const format of ["nuxt-components", "nuxt-imports", "spring-mappings", "spring-beans", "docker-inspect", "http-trace", "forge-runtime"] as const) {
    const result = collect(format, "{}");
    expect(result.limitations.every(isRuntimeArtifactLimitation)).toBe(true);
  }
  expect(collect("forge-runtime", { facts: [{ kind: "nuxt-component", name: "RoomCard", details: { sourcePath: "components/RoomCard.vue", service: "store" } }] }).facts[0]!.details).toEqual({ sourcePath: "components/RoomCard.vue" });
});

test("numeric-leading manifest component IDs retain runtime facts", () => {
  const result = collectRuntimeArtifact("forge-runtime", JSON.stringify({ facts: [{ kind: "runtime-resource", name: "catalog", details: {} }] }), "123-store");
  expect(result.facts.length).toBe(1);
  expect(result.facts[0]!.component).toBe("123-store");
  expect(validateRuntimeFact(result.facts[0], "123-store")).toBe(true);
  expect(validateRuntimeFact(result.facts[0], "123-other")).toBe(false);
});
