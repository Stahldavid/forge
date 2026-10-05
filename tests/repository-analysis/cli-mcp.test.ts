import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { handleMcpRequest } from "../../src/forge/agent-memory/mcp.ts";
import { registerFabricProject } from "../../src/forge/agent-fabric/project-registry.ts";
import { parseCli } from "../../src/forge/cli/parse.ts";

const cli = resolve("bin/forge.mjs");
test("repository CLI and MCP reject options beyond advertised query budgets", async () => {
  for (const [option, value] of [["--limit", "101"], ["--max-chars", "2047"], ["--max-chars", "50001"], ["--cursor", "a".repeat(1001)]]) {
    expect(parseCli(["repository", "context", option!, value!]).errors.length).toBeGreaterThan(0);
  }
  for (const args of [{ limit: 101 }, { maxChars: 2047 }, { cursor: "a".repeat(1001) }]) {
    const response: any = await handleMcpRequest(process.cwd(), { id: 1, method: "tools/call", params: { name: "fabric_repository_context", arguments: args } });
    expect(response.error.message).toContain("Invalid");
  }
  const invalid = spawnSync("node", [cli, "cair", "query", "Q routes", "--root", join(tmpdir(), "forge-root-that-does-not-exist"), "--json", "--no-delta"], { encoding: "utf8", windowsHide: true });
  expect(invalid.status).toBe(1);
  expect(JSON.parse(invalid.stdout).diagnostics[0].code).toBe("FORGE_REPOSITORY_ROOT");
});
test("real Node CLI discovers and queries Vue + Java + Compose outside Forge without recorder writes", () => {
  const root = mkdtempSync(join(tmpdir(), "forge-repository-cli-"));
  try {
    mkdirSync(join(root, "frontend", "src"), { recursive: true });
    mkdirSync(join(root, "backend", "src"), { recursive: true });
    writeFileSync(join(root, "frontend", "package.json"), JSON.stringify({ dependencies: { vue: "3" } }));
    writeFileSync(join(root, "frontend", "src", "App.vue"), '<script setup lang="ts">const greeting = "hello";</script><template><div>{{ greeting }}</div></template>');
    writeFileSync(join(root, "backend", "pom.xml"), "<project><artifactId>api</artifactId></project>");
    writeFileSync(join(root, "backend", "src", "Api.java"), 'package app; @RestController @RequestMapping("/api") public class Api { @GetMapping("/hello") public String hello() { return "hello"; } }');
    writeFileSync(join(root, "compose.yaml"), 'services:\n  api:\n    build: ./backend\n    ports: ["8080:8080"]\n');
    const run = (...args: string[]) => {
      const result = spawnSync("node", [cli, ...args, "--json"], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30000 });
      if (!result.stdout.trim()) throw new Error(result.stderr);
      return { code: result.status, body: JSON.parse(result.stdout) };
    };
    const draft = run("manifest", "discover");
    expect(draft.code).toBe(0);
    expect(draft.body.manifest.kind).toBe("repository");
    expect(existsSync(join(root, ".forge"))).toBe(false);
    expect(run("manifest", "discover", "--write").code).toBe(0);
    expect(run("manifest", "validate", "forge.manifest.json").code).toBe(0);
    expect(existsSync(join(root, ".forge"))).toBe(false);
    const analysis = run("repository", "analyze", "--write");
    expect(analysis.code).toBe(0);
    expect(analysis.body.snapshot.nodes.some((n: { kind: string }) => n.kind === "endpoint")).toBe(true);
    expect(analysis.body.snapshot.nodes.some((n: { kind: string }) => n.kind === "container-service")).toBe(true);
    expect(run("repository", "context", "--query", "routes").body.ok).toBe(true);
    expect(run("cair", "query", "Q routes").body.ok).toBe(true);
    expect(existsSync(join(root, ".forge", "delta"))).toBe(false);
    expect(existsSync(join(root, ".gitignore"))).toBe(false);
    writeFileSync(join(root, "backend", "src", "Api.java"), readFileSync(join(root, "backend", "src", "Api.java"), "utf8") + "\n// changed");
    expect(run("repository", "context", "--query", "routes").body.ok).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 120000);

test("MCP map queries route registered projects and do not create Delta events", async () => {
  const parent = mkdtempSync(join(tmpdir(), "forge-repository-mcp-"));
  try {
    const root = join(parent, "app"); mkdirSync(root);
    writeFileSync(join(root, "App.java"), "class App { void work() {} }");
    for (const argv of [["init", "-q"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "add", "App.java"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]]) {
      expect(spawnSync("git", argv, { cwd: root, windowsHide: true }).status).toBe(0);
    }
    writeFileSync(join(root, "forge.manifest.json"), JSON.stringify({ forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: ".", adapters: ["java"] }] }));
    for (let i = 0; i < 24; i++) writeFileSync(join(root, `.env.fixture-${i}`), "DO_NOT_READ=value");
    const options = { registryDirectory: join(parent, "registry") };
    await registerFabricProject(root, { ...options, id: "app" });
    const invoke = async (name: string, args: Record<string, unknown>) => {
      const response: any = await handleMcpRequest(parent, { id: 1, method: "tools/call", params: { name, arguments: { projectId: "app", ...args } } }, options);
      if (response.error) throw new Error(response.error.message);
      return JSON.parse(response.result.content[0].text);
    };
    const analysis = await invoke("fabric_repository_analyze", { write: true });
    expect(analysis.ok).toBe(true);
    expect(analysis.coverage.ignoredPaths.length).toBe(20);
    expect(analysis.coverage.omitted.ignoredPaths).toBeGreaterThan(0);
    const context = await invoke("fabric_repository_context", { query: "symbol App" });
    expect(context.projectContext.root).toBe(root);
    expect(context.items.some((n: { name: string }) => n.name === "App")).toBe(true);
    expect(existsSync(join(root, ".forge", "delta"))).toBe(false);
    expect(existsSync(join(parent, ".forge"))).toBe(false);
  } finally { rmSync(parent, { recursive: true, force: true }); }
}, 60000);
