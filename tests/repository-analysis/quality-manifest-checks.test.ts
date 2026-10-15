import { expect, test } from "bun:test";
import Ajv from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";
import { validateRepositoryManifest } from "../../src/forge/repository-manifest/index.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import { selectRepositoryChecks } from "../../src/forge/repository-analysis/check-selection.ts";
import type { RepositorySnapshot } from "../../src/forge/repository-analysis/types.ts";

const manifest: RepositoryManifest = {
  forgeProtocol: "2.0", kind: "repository",
  components: [
    { id: "web", root: "web", adapters: ["vue", "nuxt"], analysis: { aliases: { "@": "src", "~": "src" }, nuxt: { rootDir: ".", srcDir: "src", components: ["src/components"], imports: ["src/composables"] } } },
    { id: "api", root: "api", adapters: ["java", "spring"] },
  ],
  httpClients: [{ id: "apiClient", component: "web", files: ["src/services/**"], basePath: "/api", apiComponent: "api" }],
  checks: [
    { id: "web-typecheck", component: "web", argv: ["npm", "--prefix", "web", "run", "typecheck"], category: "typecheck", cost: "low", requires: ["node"], files: ["src/**"] },
    { id: "web-tests", component: "web", argv: ["npm", "test"], cwd: "web", category: "test", cost: "medium", files: ["src/**", "tests/**"] },
    { id: "web-css", component: "web", argv: ["npm", "run", "lint:css"], files: ["styles/**"] },
    { id: "api-test", component: "api", argv: ["./mvnw", "test"], cwd: "api", requires: ["java"], cost: "medium" },
    { id: "api-integration", component: "api", argv: ["./mvnw", "verify"], cwd: "api", category: "integration", cost: "high", requires: ["java", "docker", "network"] },
  ],
};
const schema = new Ajv({ strict: false }).compile(JSON.parse(readFileSync("schemas/forge-manifest.schema.json", "utf8")));
const evidence = { assurance: "resolved", resolution: "complete", adapter: "fixture", version: "1" } as const;
function snapshot(): RepositorySnapshot {
  return {
    provider: "repository", schemaVersion: 1, snapshotId: "fixture", root: "fixture", manifestHash: "fixture", scenarioHash: "fixture", createdAt: "fixture", manifest,
    files: { "web/src/Auth.vue": { hash: "a", size: 1, component: "web", adapter: "vue", status: "analyzed" }, "api/src/Auth.java": { hash: "b", size: 1, component: "api", adapter: "java", status: "analyzed" } },
    nodes: [
      { id: "ui", kind: "component", name: "Auth", file: "web/src/Auth.vue", component: "web", metadata: {}, evidence },
      { id: "route", kind: "route", name: "AuthAPI", file: "api/src/Auth.java", component: "api", metadata: {}, evidence },
    ],
    edges: [{ id: "binding", from: "ui", to: "route", kind: "http-call", metadata: {}, evidence }],
    coverage: { found: 2, analyzed: 2, ignored: 0, unsupported: 0, errors: 0, reused: 0, limitations: [], diagnostics: [], ignoredPaths: [] },
  };
}

test("optional repository quality declarations validate in runtime and JSON schema while legacy manifests stay valid", () => {
  expect(validateRepositoryManifest(manifest).diagnostics).toEqual([]); expect(schema(manifest)).toBe(true);
  const legacy = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["java"] }], checks: [{ id: "compile", component: "app", argv: ["mvn", "test"] }] };
  expect(validateRepositoryManifest(legacy).diagnostics).toEqual([]); expect(schema(legacy)).toBe(true);
});

test("analysis declarations reject traversal, config evaluation, unknown fields, URL origins and secret-shaped requirements", () => {
  for (const analysis of [
    { aliases: { "@": "../outside" } }, { aliases: { "@": "C:/outside" } }, { aliases: { constructor: "src" } },
    { nuxt: { srcDir: "../outside" } }, { nuxt: { imports: ["src\\outside"] } }, { nuxt: { configFile: "nuxt.config.ts" } }, { execute: "node config.js" },
  ]) {
    const proposal = { ...manifest, components: [{ ...manifest.components[0], analysis }, manifest.components[1]] };
    expect(validateRepositoryManifest(proposal).manifest).toBeNull(); expect(schema(proposal)).toBe(false);
  }
  for (const client of [
    { ...manifest.httpClients![0], basePath: "https://user:secret@host/api" },
    { ...manifest.httpClients![0], basePath: "//host/api" }, { ...manifest.httpClients![0], basePath: "/api?token=secret" },
    { ...manifest.httpClients![0], basePath: "/../api" }, { ...manifest.httpClients![0], basePath: "/%2e%2e/api" },
    { ...manifest.httpClients![0], files: ["../outside"] }, { ...manifest.httpClients![0], apiComponent: "unknown" },
    { ...manifest.httpClients![0], headers: { Authorization: "secret" } },
  ]) expect(validateRepositoryManifest({ ...manifest, httpClients: [client] }).manifest).toBeNull();
  for (const additions of [{ cwd: "../outside" }, { files: ["../outside"] }, { requires: ["OPENAI_API_KEY=secret"] }, { requires: ["node", "node"] }, { category: "deploy" }, { cost: "free" }, { env: { TOKEN: "secret" } }]) {
    const proposal = { ...manifest, checks: [{ ...manifest.checks![0], ...additions }] };
    expect(validateRepositoryManifest(proposal).manifest).toBeNull(); expect(schema(proposal)).toBe(false);
  }
});

test("declaration bounds and scoped client identity are enforced", () => {
  const injectedClient = { ...manifest, httpClients: [{ id: "$api", component: "web", basePath: "/api", apiComponent: "api" }] };
  expect(validateRepositoryManifest(injectedClient).diagnostics).toEqual([]); expect(schema(injectedClient)).toBe(true);
  for (const binding of ["$api()", "api/client", "api:client", " api", "api\n", "api;process.exit()", "9api"]) {
    const invalidBinding = { ...injectedClient, httpClients: [{ ...injectedClient.httpClients[0], id: binding }] };
    expect(validateRepositoryManifest(invalidBinding).manifest).toBeNull(); expect(schema(invalidBinding)).toBe(false);
  }
  expect(validateRepositoryManifest({ ...manifest, components: [{ id: "$api", root: ".", adapters: ["typescript"] }] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, components: [{ ...manifest.components[0], analysis: { aliases: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`a${i}`, "src"])) } }] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, checks: [{ ...manifest.checks![0], requires: Array.from({ length: 33 }, (_, i) => `tool${i}`) }] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, httpClients: [manifest.httpClients![0], manifest.httpClients![0]] }).manifest).toBeNull();
  expect(validateRepositoryManifest({ ...manifest, httpClients: [manifest.httpClients![0], { ...manifest.httpClients![0], component: "api" }] }).diagnostics).toEqual([]);
});

test("task scopes select relevant checks, preserve root argv behavior and never execute declarations", () => {
  const selected = selectRepositoryChecks(snapshot(), { scope: ["web/src/Auth.vue"], capabilities: ["node"] });
  expect(selected.execution).toBe("not-executed");
  expect(selected.checks.map(check => check.id)).toEqual(["web-typecheck", "web-tests"]);
  expect(selected.checks[0]).toMatchObject({ cwd: ".", argv: ["npm", "--prefix", "web", "run", "typecheck"], requirements: { status: "satisfied", missing: [] } });
  expect(selected.checks[1]!.cwd).toBe("web");
  expect(selected.checks.every(check => check.reasons.includes("check-files-match-task") && check.execution === "not-executed")).toBe(true);
  expect(selectRepositoryChecks(snapshot(), { scope: ["web/src/not-yet-created.vue"] }).checks.map(check => check.id)).toEqual(["web-typecheck", "web-tests"]);
  expect(selectRepositoryChecks(snapshot(), { scope: ["web/styles/new.css"] }).checks.map(check => check.id)).toEqual(["web-css"]);
  const narrow = snapshot(); narrow.manifest = { ...manifest, checks: [...manifest.checks!, { id: "only-test-files", component: "web", argv: ["npm", "test"], files: ["**/*.test.ts"] }] };
  expect(selectRepositoryChecks(narrow, { scope: ["web/src/Auth.vue"] }).checks.some(check => check.id === "only-test-files")).toBe(false);
  expect(selectRepositoryChecks(narrow, { scope: ["web/src/new-component.vue"] }).checks.some(check => check.id === "only-test-files")).toBe(false);
  expect(selectRepositoryChecks(narrow, { scope: ["web/src/new-component.test.ts"] }).checks.some(check => check.id === "only-test-files")).toBe(true);
  expect(selectRepositoryChecks(snapshot(), {}).checks).toEqual([]);
});

test("explicit components and resolved adjacent nodes select checks with honest capability status", () => {
  const byNodes = selectRepositoryChecks(snapshot(), { nodeIds: ["ui"], capabilities: ["node", "java"] });
  expect(byNodes.checks.map(check => check.id)).toEqual(["web-typecheck", "api-test", "web-tests", "api-integration"]);
  expect(byNodes.checks.find(check => check.id === "api-integration")!).toMatchObject({ requirements: { status: "missing", missing: ["docker", "network"] }, reasons: ["related-node-component:api"] });
  expect(selectRepositoryChecks(snapshot(), { components: ["api"] }).checks.find(check => check.id === "api-test")!.requirements).toEqual({ status: "unknown", missing: [] });
  expect(selectRepositoryChecks(snapshot(), { components: ["web"] }).checks).toHaveLength(3);
  const uncertain = snapshot(); uncertain.edges[0]!.evidence = { ...evidence, assurance: "inferred", resolution: "partial" };
  expect(selectRepositoryChecks(uncertain, { nodeIds: ["ui"] }).checks.some(check => check.component === "api")).toBe(false);
});

test("selectors fail closed on invalid input and unknown references provide diagnostics", () => {
  expect(selectRepositoryChecks(snapshot(), { scope: ["../escape"] })).toMatchObject({ checks: [], execution: "not-executed" });
  expect(selectRepositoryChecks(snapshot(), { components: ["unknown"], nodeIds: ["missing"] }).diagnostics).toHaveLength(2);
  const invalid = snapshot(); invalid.manifest = { ...manifest, checks: [{ ...manifest.checks![0]!, component: "unknown" }] };
  expect(selectRepositoryChecks(invalid, { scope: ["web"] }).checks).toEqual([]);
  const original = JSON.stringify(manifest); const selected = selectRepositoryChecks(snapshot(), { scope: ["web"] }); selected.checks[0]!.argv.push("extra");
  expect(JSON.stringify(manifest)).toBe(original);
});
