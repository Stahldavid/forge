import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { runRepositoryCommand } from "../../src/forge/cli/repository.ts";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { analyzeRepository } from "../../src/forge/repository-analysis/analyze.ts";
import type { RepositoryManifest } from "../../src/forge/repository-manifest/types.ts";
import { prepareFabricRepositoryContext } from "../../src/forge/agent-fabric/repository-context.ts";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) { if (dirname(resolve(root)) !== resolve(tmpdir()) || !root.includes("forge-runtime-cli-")) throw new Error("Unsafe cleanup"); rmSync(root, { recursive: true, force: true }); } });
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "forge-runtime-cli-")); roots.push(root);
  mkdirSync(join(root, "web")); writeFileSync(join(root, "web/App.vue"), "<template><div>checkout</div></template>");
  writeFileSync(join(root, "capture.mjs"), `import {mkdirSync,writeFileSync} from 'node:fs';mkdirSync('web/.nuxt',{recursive:true});writeFileSync('web/.nuxt/components.d.ts', 'declare module "vue" { export interface GlobalComponents { CheckoutPanel: typeof import("../App.vue")["default"] } }');`);
  const manifest: RepositoryManifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "web", root: "web", adapters: ["vue", "nuxt"] }],
    runtime: { observations: [{ id: "registry", component: "web", commands: [{ argv: [process.execPath, "capture.mjs"], cwd: "." }], artifacts: [{ path: "web/.nuxt/components.d.ts", format: "nuxt-components" }] }] } };
  writeFileSync(join(root, "forge.manifest.json"), JSON.stringify(manifest));
  await analyzeRepository(root, manifest, { write: true });
  return root;
}

test("runtime CLI requires execution opt-in and keeps planning/context read-only", async () => {
  const root = await fixture();
  const args = ["repository", "runtime-plan", "--root", root, "--environment-id", "local", "--observation-id", "registry", "--json"];
  expect(parseCli(args).errors).toEqual([]); expect(hasUnknownOption(args)).toBeNull();
  expect(parseCli(["repository", "runtime-observe", "--environment-id", "local"]).errors.length).toBeGreaterThan(0);
  expect(parseCli([...args, "--execute"]).errors.length).toBeGreaterThan(0);
  expect(parseCli([...args, "--write"]).errors.length).toBeGreaterThan(0);
  expect(parseCli(["repository", "analyze", "--execute"]).errors.length).toBeGreaterThan(0);
  const base = { cwd: root, root, json: true, write: false, environmentId: "local" };
  expect((await runRepositoryCommand({ ...base, action: "runtime-plan" })).exitCode).toBe(0);
  expect(existsSync(join(root, "web/.nuxt"))).toBe(false);
  expect((await runRepositoryCommand({ ...base, action: "runtime-observe" })).exitCode).toBe(1);
  expect((await runRepositoryCommand({ ...base, action: "runtime-observe", execute: true, write: true })).exitCode).toBe(0);
  const context = await runRepositoryCommand({ ...base, action: "runtime-context", query: "CheckoutPanel", maxChars: 2048 });
  expect(context.exitCode).toBe(0); expect(JSON.stringify(context.context)).toContain("CheckoutPanel");
  expect(existsSync(join(root, "web/.nuxt"))).toBe(false);
  writeFileSync(join(root, "capture.mjs"), "throw new Error('changed unselected input');");
  expect((await runRepositoryCommand({ ...base, action: "runtime-context" })).exitCode).toBe(1);
}, 30000);

test("MCP exposes the same explicit plan/observe/context contract", async () => {
  const root = await fixture();
  const call = async (name: string, args: Record<string, unknown> = {}) => handleMcpRequest(root, { id: 1, method: "tools/call", params: { name, arguments: args } });
  const listed = await handleMcpRequest(root, { id: 2, method: "tools/list" });
  expect(JSON.stringify(listed)).toContain("fabric_repository_runtime_observe");
  const plan = await call("fabric_repository_runtime_plan", { environmentId: "local" });
  expect(JSON.stringify(plan)).toContain("registry");
  expect(existsSync(join(root, "web/.nuxt"))).toBe(false);
  const rejected = await call("fabric_repository_runtime_observe", { environmentId: "local" });
  expect(JSON.stringify(rejected)).toContain("--execute");
  const result = await call("fabric_repository_runtime_observe", { environmentId: "local", execute: true, write: true });
  expect(JSON.stringify(result)).toContain("CheckoutPanel");
  const context = await call("fabric_repository_runtime_context", { environmentId: "local", query: "CheckoutPanel" });
  expect(JSON.stringify(context)).toContain("CheckoutPanel");
  const other = await call("fabric_repository_runtime_context", { environmentId: "different" });
  expect(JSON.stringify(other)).not.toContain('"facts":[{"kind"');
}, 30000);

test("Fabric adds matching source observations without executing them and drops reuse after composition", async () => {
  const root = await fixture();
  const result = await runRepositoryCommand({ action: "runtime-observe", cwd: root, root, environmentId: "local", execute: true, write: true, json: true });
  expect(result.exitCode).toBe(0);
  const clone = mkdtempSync(join(tmpdir(), "forge-runtime-cli-")); roots.push(clone);
  cpSync(root, clone, { recursive: true, filter: path => !path.replaceAll("\\", "/").includes("/.forge") });
  const prepared = await prepareFabricRepositoryContext(root, clone, "App CheckoutPanel", ["web/App.vue"]);
  expect(prepared?.metadata.status).toBe("ready");
  expect(prepared?.metadata.runtime?.phase).toBe("source-observed-matching-input");
  expect(prepared?.prompt).toContain("CheckoutPanel");
  expect(existsSync(join(clone, "web/.nuxt"))).toBe(false);
  expect(existsSync(join(clone, ".forge/repository"))).toBe(false);
  writeFileSync(join(clone, "capture.mjs"), "throw new Error('upstream composition changed runtime input');");
  const changed = await prepareFabricRepositoryContext(root, clone, "App CheckoutPanel", ["web/App.vue"]);
  expect(changed?.metadata.status).toBe("ready"); expect(changed?.metadata.runtime).toBeUndefined();
  expect(changed?.prompt).not.toContain('"assurance":"observed-artifact"');
}, 30000);
