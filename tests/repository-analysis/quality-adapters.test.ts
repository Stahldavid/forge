import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import { scanRepository } from "../../src/forge/repository-analysis/scanner.ts";
import { createNuxtImportResolver, enrichNuxtRepository } from "../../src/forge/repository-analysis/nuxt-resolution.ts";
import { enrichHttpRepository } from "../../src/forge/repository-analysis/http-resolution.ts";
import { analyzeTypeScript } from "../../src/forge/repository-analysis/adapters/typescript.ts";
import { repositoryQualitySummary } from "../../src/forge/repository-analysis/quality.ts";
import type { RepositorySnapshot } from "../../src/forge/repository-analysis/types.ts";

const temporaryRoots: string[] = [];
function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "forge-adapter-quality-")); temporaryRoots.push(root);
  for (const [file, text] of Object.entries(files)) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); }
  return root;
}
afterEach(() => { for (const root of temporaryRoots.splice(0)) { if (!root.startsWith(join(tmpdir(), "forge-adapter-quality-"))) throw new Error("Unsafe fixture cleanup"); rmSync(root, { recursive: true, force: true }); } });

const nuxt: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["nuxt", "vue", "typescript"] }] };
function apply(snapshot: RepositorySnapshot, result: ReturnType<typeof enrichNuxtRepository>): void {
  snapshot.nodes = [...new Map([...snapshot.nodes, ...result.nodes].map((node) => [node.id, node])).values()]; snapshot.edges = [...new Map([...snapshot.edges, ...result.edges].map((edge) => [edge.id, edge])).values()]; snapshot.coverage.diagnostics.push(...result.diagnostics);
}

describe("static Nuxt and HTTP adapter quality", () => {
  test("literal Nuxt srcDir, root aliases and local component/composable autoimports resolve without config execution", async () => {
    const root = fixture({
      "web/nuxt.config.ts": "export default defineNuxtConfig({ srcDir: 'src', alias: { '@shared':'./shared' } });",
      "web/package.json": '{"dependencies":{"nuxt":"^3.0.0"}}',
      "web/src/pages/index.vue": '<script setup lang="ts">useOrders();</script><template><BaseButton/></template>',
      "web/src/components/base/BaseButton.vue": "<template><button/></template>",
      "web/src/composables/useOrders.ts": "export function useOrders() { return []; }",
      "web/shared/helper.ts": "export function helper() {}",
      ".env": "PASSWORD=not-read",
    });
    const sources = scanRepository(root, nuxt).sources; const resolver = createNuxtImportResolver(sources, nuxt); const page = sources.find((source) => source.path.endsWith("index.vue"))!;
    expect(resolver(page, "~/composables/useOrders").file).toBe("web/src/composables/useOrders.ts"); expect(resolver(page, "~~/package.json").file).toBe("web/package.json"); expect(resolver(page, "@shared/helper").file).toBe("web/shared/helper.ts"); expect(resolver(page, "vue").classification).toBe("external");
    const snapshot = await analyzeRepository(root, nuxt); const enriched = enrichNuxtRepository(snapshot, sources); apply(snapshot, enriched);
    const button = snapshot.nodes.find((node) => node.kind === "ui-component" && node.name === "BaseButton")!; const useOrders = snapshot.nodes.find((node) => node.kind === "symbol" && node.name === "useOrders")!;
    expect(snapshot.edges.some((edge) => edge.kind === "renders" && edge.to === button.id && edge.metadata.association === "nuxt-static-autoimport")).toBe(true); expect(snapshot.edges.some((edge) => edge.kind === "calls" && edge.to === useOrders.id && edge.metadata.association === "nuxt-static-autoimport")).toBe(true);
    expect(snapshot.nodes.find((node) => node.kind === "ui-reference" && node.name === "BaseButton")!.evidence.resolution).toBe("partial"); expect(JSON.stringify(snapshot)).not.toContain("not-read");
  });

  test("ambiguous local autoimports and alias candidates preserve uncertainty", async () => {
    const root = fixture({ "web/nuxt.config.ts": "export default defineNuxtConfig({components:[{path:'~/components',pathPrefix:false}]});", "web/pages/index.vue": "<template><Card/></template>", "web/components/a/Card.vue": "<template><div/></template>", "web/components/b/Card.vue": "<template><div/></template>", "web/utils/common.ts": "export function useThing() {}", "web/composables/common.ts": "export function useThing() {}", "web/pages/other.vue": "<script setup>useThing();</script>", "web/same.ts": "export const same = 1;", "web/same.vue": "<template><div/></template>" });
    const sources = scanRepository(root, nuxt).sources; const snapshot = await analyzeRepository(root, nuxt); const result = enrichNuxtRepository(snapshot, sources);
    expect(result.diagnostics.filter((diagnostic) => diagnostic.code === "REPOSITORY_NUXT_AUTOIMPORT_AMBIGUOUS").length).toBeGreaterThanOrEqual(2); expect(result.edges.filter((edge) => edge.metadata.association === "nuxt-static-autoimport")).toHaveLength(0); expect(createNuxtImportResolver(sources, nuxt)(sources[0], "~/same").classification).toBe("ambiguous");
  });

  test("dynamic Nuxt config is never evaluated and unsafe aliases do not escape source inventory", async () => {
    const root = fixture({ "web/nuxt.config.ts": "globalThis.__FORGE_CONFIG_EXECUTED = true; export default defineNuxtConfig({srcDir: process.env.PRIVATE_ROOT, alias:{'@unsafe':'../../../outside'}});", "web/components/Card.vue": "<template><div/></template>" });
    const sources = scanRepository(root, nuxt).sources; const resolver = createNuxtImportResolver(sources, nuxt); expect(resolver(sources[0], "~/components/Card").classification).toBe("unresolved"); expect(resolver(sources[0], "@unsafe/value").classification).toBe("unresolved");
    const snapshot = await analyzeRepository(root, nuxt); expect(enrichNuxtRepository(snapshot, sources).diagnostics.some((item) => item.code === "REPOSITORY_NUXT_CONFIG_PARTIAL")).toBe(true); expect((globalThis as unknown as Record<string, unknown>).__FORGE_CONFIG_EXECUTED).toBeUndefined();
  });

  test("rejected alias declarations shadow defaults and shorter aliases while unknown scoped packages remain external", () => {
    const root = fixture({ "web/nuxt.config.ts": "export default defineNuxtConfig({alias:{'@':process.env.SOURCE_DIR,'@shared':'./shared','@shared/private':process.env.PRIVATE_DIR,dynamicAlias}});", "web/value.ts": "export const value=1;", "web/shared/private/value.ts": "export const value=2;", "web/shared/public/value.ts": "export const value=3;" });
    const sources = scanRepository(root, nuxt).sources; const resolver = createNuxtImportResolver(sources, nuxt);
    expect(resolver(sources[0], "@/value").classification).toBe("unresolved");
    expect(resolver(sources[0], "@shared/private/value").classification).toBe("unresolved");
    expect(resolver(sources[0], "dynamicAlias/value").classification).toBe("unresolved");
    expect(resolver(sources[0], "@shared/public/value").file).toBe("web/shared/public/value.ts");
    expect(resolver(sources[0], "@scope/package").classification).toBe("external");
    const overridden: RepositoryManifest = { ...nuxt, components: nuxt.components.map((component) => ({ ...component, analysis: { aliases: { "@shared/private": "shared/private" } } })) };
    expect(createNuxtImportResolver(sources, overridden)(sources[0], "@shared/private/value").file).toBe("web/shared/private/value.ts");
  });

  test("HTTP immutable constants, templates and Axios/$fetch factories retain prefixes and reject dynamic env", () => {
    const text = "import axios from 'axios'; const prefix = '/api'; const config = {baseURL: prefix}; const api = axios.create({baseURL: config.baseURL}); const id = 42; api.get(`/orders/${id}`); const local = $fetch.create({baseURL: '/internal'}); local('/users'); const dynamic = axios.create({baseURL: process.env.API_URL}); dynamic.get('/orders'); const secret = 'credential-value'; fetch('/api/' + secret);";
    const facts = analyzeTypeScript({ path: "client.ts", text, hash: "hash", component: "web", adapter: "typescript" }); const calls = facts.nodes.filter((node) => node.kind === "http-call");
    expect(calls.some((node) => node.metadata.path === "/api/orders/42" && node.metadata.clientConfidence === "factory")).toBe(true); expect(calls.some((node) => node.metadata.path === "/internal/users")).toBe(true); expect(calls.find((node) => node.metadata.clientId === "dynamic")!.metadata.baseKnown).toBe(false); expect(JSON.stringify(facts)).not.toContain("credential-value");
  });

  test("mutated client options and document-relative fetch URLs are unresolved while native fetch ignores baseURL", () => {
    const text = "import axios from 'axios'; const options = {baseURL:'/before'}; options.baseURL = '/after'; const api = axios.create(options); api.get('/orders'); fetch('relative/orders'); fetch('/orders',{baseURL:'/ignored'});";
    const facts = analyzeTypeScript({ path: "client.ts", text, hash: "hash", component: "web", adapter: "typescript" }); const calls = facts.nodes.filter((node) => node.kind === "http-call");
    expect(calls.find((node) => node.metadata.clientId === "api")!.metadata.baseKnown).toBe(false); expect(calls.find((node) => node.metadata.requestPath === "/relative/orders")!.metadata.baseKnown).toBe(false); expect(calls.find((node) => node.metadata.clientId === "fetch" && node.metadata.path === "/orders")!.metadata.path).toBe("/orders"); expect(calls.some((node) => node.metadata.path === "/ignored/orders")).toBe(false);
  });

  test("Nuxt provided Axios client is associated through plugin declaration, without relying on receiver spelling", async () => {
    const root = fixture({ "web/nuxt.config.ts": "export default defineNuxtConfig({});", "web/plugins/api.ts": "import axios from 'axios'; export default defineNuxtPlugin(()=>{ const transport = axios.create({baseURL:'/api'}); return {provide:{transport}}; });", "web/main.ts": "const {$transport} = useNuxtApp(); $transport.get('/orders');", "api/Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders") public String get() { return "x"; } }' });
    const config: RepositoryManifest = { ...nuxt, components: [...nuxt.components, { id: "api", root: "api", adapters: ["java"] }] };
    const sources = scanRepository(root, config).sources; const snapshot = await analyzeRepository(root, config); const result = enrichHttpRepository(snapshot, sources); const endpoint = snapshot.nodes.find((node) => node.kind === "endpoint")!;
    expect(snapshot.nodes.find((node) => node.kind === "http-client")!.metadata.providedAs).toEqual(["$transport"]); expect([...snapshot.edges, ...result.edges].some((edge) => edge.to === endpoint.id)).toBe(true);
  });

  test("manifest client mapping disambiguates services and handles a dynamic client only when explicitly configured", async () => {
    const root = fixture({ "web/main.ts": "import axios from 'axios'; const api = axios.create({baseURL: process.env.API_URL}); api.get('/orders');", "apiA/Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders") public String get() { return "a"; } }', "apiB/Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders") public String get() { return "b"; } }' });
    const base: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }, { id: "a", root: "apiA", adapters: ["java"] }, { id: "b", root: "apiB", adapters: ["java"] }] };
    const sources = scanRepository(root, base).sources; const snapshot = await analyzeRepository(root, base); const unmapped = enrichHttpRepository(snapshot, sources); expect(unmapped.edges.filter((edge) => ["manifest-http-client", "static-client-method-path"].includes(String(edge.metadata.association)))).toHaveLength(0);
    const mapped = { ...snapshot, manifest: { ...base, httpClients: [{ id: "api", component: "web", files: ["main.ts"], basePath: "/api", apiComponent: "a" }] } }; const result = enrichHttpRepository(mapped, sources);
    const endpoint = snapshot.nodes.find((node) => node.kind === "endpoint" && node.component === "a")!; expect(result.edges.some((edge) => edge.to === endpoint.id && edge.evidence.assurance === "declared")).toBe(true); expect(result.edges.some((edge) => snapshot.nodes.some((node) => node.id === edge.to && node.kind === "endpoint" && node.component === "b"))).toBe(false);
  });

  test("simple returned-fetch wrappers work across named and namespace imports without classifying unknown function names", async () => {
    const root = fixture({ "web/api.ts": "const prefix = '/api'; export function apiGet(path: string) { return fetch(prefix + path); }", "web/main.ts": "import { apiGet as load } from './api'; import * as api from './api'; load('/orders'); api.apiGet('/orders'); unknownGet('/orders');", "api/Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders") public String get() { return "x"; } }' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }, { id: "api", root: "api", adapters: ["java"] }] };
    const sources = scanRepository(root, config).sources; const snapshot = await analyzeRepository(root, config); const result = enrichHttpRepository(snapshot, sources); const endpoint = snapshot.nodes.find((node) => node.kind === "endpoint")!;
    apply(snapshot, result); expect(snapshot.nodes.filter((node) => node.kind === "http-call" && node.metadata.wrapperId)).toHaveLength(2); expect(snapshot.edges.filter((edge) => edge.to === endpoint.id)).toHaveLength(2); expect(snapshot.nodes.some((node) => node.metadata.clientId === "unknownGet")).toBe(false);
  });

  test("test-suite is distinct and test body bounds stay in original source coordinates", () => {
    const text = "describe('suite',()=>{ test('case',()=>{ const local = 1; }); });"; const facts = analyzeTypeScript({ path: "main.test.ts", text, hash: "hash", component: "web", adapter: "typescript" }); expect(facts.nodes.filter((node) => node.kind === "test-suite")).toHaveLength(1); const node = facts.nodes.find((node) => node.kind === "test")!; const body = node.metadata.testBody as { start: number; end: number }; expect(text.slice(body.start, body.end)).toBe("{ const local = 1; }");
  });

  test("arrow callable owns awaited response calls and numeric segment patterns link as partial navigation while remaining dynamic", async () => {
    const root = fixture({ "web/service.ts": "import axios from 'axios'; const api=axios.create({baseURL:'/api'}); export const getContext=async(orderId:number)=>{ const response=await api.get(`/orders/${orderId}/schedule-context`); return response.data; };", "api/Controller.java": '@RequestMapping("/api/orders") public class Controller { @GetMapping("/{id}/schedule-context") public String get() { return "x"; } @GetMapping("/status/schedule-context") public String status() { return "x"; } }' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }, { id: "api", root: "api", adapters: ["java"] }] };
    const snapshot = await analyzeRepository(root, config); const callable = snapshot.nodes.find((node) => node.kind === "symbol" && node.name === "getContext")!; const response = snapshot.nodes.find((node) => node.kind === "symbol" && node.name === "response")!; const call = snapshot.nodes.find((node) => node.kind === "http-call")!;
    expect(snapshot.edges.some((edge) => edge.from === callable.id && edge.to === call.id && edge.kind === "calls")).toBe(true); expect(snapshot.edges.some((edge) => edge.from === response.id && edge.to === call.id)).toBe(false);
    expect(call.metadata.requestPathPattern).toBe("/orders/{orderId}/schedule-context"); expect(call.metadata.path).toBeUndefined(); expect(repositoryQualitySummary(snapshot).dynamicHttpCalls).toBe(1);
    const edge = snapshot.edges.find((edge) => edge.from === call.id && snapshot.nodes.some((node) => node.id === edge.to && node.kind === "endpoint"))!;
    expect(edge.metadata.pathPatternMatch).toBe(true); expect(edge.metadata.requestPathPattern).toBe("/api/orders/{orderId}/schedule-context"); expect(edge.metadata.resolvedPath).toBeUndefined(); expect(edge.evidence.resolution).toBe("partial"); expect(edge.evidence.assurance).toBe("inferred"); expect(edge.metadata.runtimeRoutingVerified).toBe(false);
  });

  test("dynamic Nuxt client base remains unknown until explicit manifest mapping supplies routing scope", async () => {
    const root = fixture({ "web/service.ts": "export const getContext=async(id:number)=>{ const {$api}=useNuxtApp(); const response=await $api.get(`/orders/${id}`); return response.data; };", "api/Controller.java": '@RequestMapping("/api") public class Controller { @GetMapping("/orders/{id}") public String get() { return "x"; } }' });
    const base: RepositoryManifest = { ...nuxt, components: [...nuxt.components, { id: "api", root: "api", adapters: ["java"] }] };
    const snapshot = await analyzeRepository(root, base); const call = snapshot.nodes.find((node) => node.kind === "http-call")!; expect(call.metadata.baseKnown).toBe(false); expect(snapshot.edges.some((edge) => edge.from === call.id)).toBe(false);
    const mapped = { ...snapshot, manifest: { ...base, httpClients: [{ id: "$api", component: "web", basePath: "/api", apiComponent: "api" }] } }; const result = enrichHttpRepository(mapped, scanRepository(root, base).sources);
    const edge = result.edges.find((edge) => edge.from === call.id)!; expect(edge.metadata.pathPatternMatch).toBe(true); expect(edge.evidence.assurance).toBe("declared"); expect(edge.evidence.resolution).toBe("partial"); expect(call.metadata.baseKnown).toBe(false); expect(call.metadata.path).toBeUndefined();
  });

  test("segment patterns reject embedded parameters, dynamic hosts/query/concatenation and unbounded string segments", () => {
    const text = "export const load=async(id:number,name:string,host:string)=>{ fetch(`/orders/${id}`); fetch(`/orders/${encodeURIComponent(name)}`); fetch(`/orders/prefix-${id}`); fetch(`https://${host}/orders/${id}`); fetch(`/orders/${id}?q=${name}`); fetch('/orders/'+id); fetch(`/orders/${name}`); };";
    const facts = analyzeTypeScript({ path: "service.ts", text, hash: "hash", component: "web", adapter: "typescript" }); const calls = facts.nodes.filter((node) => node.kind === "http-call");
    expect(calls).toHaveLength(7); expect(calls.filter((node) => typeof node.metadata.requestPathPattern === "string")).toHaveLength(2); expect(calls.every((node) => node.metadata.path === undefined)).toBe(true);
    expect(calls[0].metadata.requestPathPattern).toBe("/orders/{id}"); expect(calls[1].metadata.requestPatternParameters).toEqual([{ name: "name", kind: "encoded-string" }]); expect(facts.diagnostics.filter((item) => item.code === "REPOSITORY_DYNAMIC_URL")).toHaveLength(7);
  });

  test("literal and parameter endpoints overlapping a request pattern preserve ambiguity and nested callables own their calls", async () => {
    const root = fixture({ "web/service.ts": "export const load=async(id:number)=>{ const nested=async()=>{ const response=await fetch('/fixed'); return response; }; const response=await fetch(`/orders/${id}`); return response; };", "api/Controller.java": '@RequestMapping("/orders") public class Controller { @GetMapping("/{id}") public String get() { return "x"; } @GetMapping("/42") public String literal() { return "x"; } }' });
    const config: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["typescript"] }, { id: "api", root: "api", adapters: ["java"] }] };
    const snapshot = await analyzeRepository(root, config); const call = snapshot.nodes.find((node) => node.kind === "http-call" && node.metadata.requestPathPattern)!; const nestedCall = snapshot.nodes.find((node) => node.kind === "http-call" && node.metadata.path === "/fixed")!; const nested = snapshot.nodes.find((node) => node.kind === "symbol" && node.name === "nested")!; const outer = snapshot.nodes.find((node) => node.kind === "symbol" && node.name === "load")!;
    expect(snapshot.edges.some((edge) => edge.from === call.id)).toBe(false); expect(snapshot.coverage.diagnostics.some((item) => item.code === "REPOSITORY_HTTP_AMBIGUOUS")).toBe(true);
    expect(snapshot.edges.some((edge) => edge.from === nested.id && edge.to === nestedCall.id)).toBe(true); expect(snapshot.edges.some((edge) => edge.from === outer.id && edge.to === nestedCall.id)).toBe(false); expect(snapshot.edges.some((edge) => edge.from === outer.id && edge.to === call.id)).toBe(true);
  });
});
