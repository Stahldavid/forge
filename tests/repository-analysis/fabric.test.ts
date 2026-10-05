import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareFabricRepositoryContext } from "../../src/forge/agent-fabric/repository-context.ts";
import { ManagedRunService } from "../../src/forge/agent-fabric/managed-run-service.ts";
import { managedDigest } from "../../src/forge/agent-fabric/managed-run-contract.ts";
import type { CodexWorkerInput, CodexWorkerOutput } from "../../src/forge/agent-fabric/codex-sdk-worker.ts";
import { captureManagedBase, prepareManagedWorkspace, captureManagedArtifact, publishManagedArtifacts } from "../../src/forge/agent-fabric/managed-workspace.ts";

const manifest = { forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: "src", adapters: ["typescript"] }],
  checks: [{ id: "never-implicit", component: "app", argv: ["node", "-e", "require('fs').writeFileSync('implicit-ran','bad')"] }] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "forge-repo-context-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "main.ts"), "export function originalFeature() { return 1; }\n");
  return root;
}
const git = (root: string, args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: "pipe" });

test("repository context is opt-in and does not require Git or execute manifest checks", async () => {
  const root = await fixture();
  try {
    expect(await prepareFabricRepositoryContext(root, root, "originalFeature", ["src"])).toBeUndefined();
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    const context = await prepareFabricRepositoryContext(root, root, "originalFeature", ["src"]);
    expect(context?.metadata.status).toBe("ready");
    expect(context?.prompt).toContain("originalFeature");
    expect(context?.prompt).toContain("never-implicit");
    await expect(access(join(root, "implicit-ran"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(join(root, ".forge", "repository"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(root, "forge.manifest.json"), '{"forgeProtocol":"2.0","kind":"repository","components":[]}');
    expect((await prepareFabricRepositoryContext(root, root, "originalFeature"))?.metadata.status).toBe("unavailable");
    await writeFile(join(root, "forge.manifest.json"), '{"forgeProtocol":"2.0","kind":"repository","components":SENSITIVE-MANIFEST-CONTENT}');
    const invalid = await prepareFabricRepositoryContext(root, root, "originalFeature");
    expect(invalid?.metadata.status).toBe("unavailable");
    expect(JSON.stringify(invalid)).not.toContain("SENSITIVE-MANIFEST-CONTENT");
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify({ forgeProtocol: "1.0", service: { name: "existing", transport: "http", baseUrl: "http://localhost:8080" }, entries: [] }));
    expect(await prepareFabricRepositoryContext(root, root, "originalFeature")).toBeUndefined();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("executor instructions are text, and bounded context keeps graph endpoints present", async () => {
  const root = await fixture();
  try {
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    const source = Array.from({ length: 80 }, (_, index) => `export function feature${index}() { return ${index > 0 ? `feature${index - 1}()` : "0"}; }`).join("\n");
    await writeFile(join(root, "src", "main.ts"), source);
    // "impact" used to be interpreted as a query operator instead of task instructions.
    const context = await prepareFabricRepositoryContext(root, root, "impact of this change", ["src"]);
    expect(context?.metadata.status).toBe("ready");
    const packet = JSON.parse(context!.prompt.slice(context!.prompt.indexOf("\n") + 1));
    expect(JSON.stringify(packet).length).toBeLessThanOrEqual(16000);
    expect(packet.truncated).toBe(true);
    expect(packet.nodes.some((node: any) => node.kind === "symbol")).toBe(true);
    const ids = new Set(packet.nodes.map((node: any) => node.id));
    expect(packet.edges.every((edge: any) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
    expect(context?.metadata.phase).toBe("prepared-input");
    await expect(access(join(root, ".forge", "repository"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("managed workers receive fresh clone maps after upstream changes, without analysis writes or implicit commands", async () => {
  const root = await fixture(); let service: ManagedRunService | undefined;
  try {
    git(root, ["init", "-q"]); git(root, ["add", "."]);
    git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
    // Newly generated, untracked analysis configuration must be captured as readonly context.
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    const inputs: CodexWorkerInput[] = [];
    const worker = async (input: CodexWorkerInput): Promise<CodexWorkerOutput> => {
      inputs.push(input);
      expect(input.prompt).toContain("Repository analysis of THIS prepared clone");
      expect(await readFile(join(input.cwd, "forge.manifest.json"), "utf8")).toBe(JSON.stringify(manifest));
      await expect(access(join(input.cwd, ".forge", "repository"))).rejects.toMatchObject({ code: "ENOENT" });
      await expect(access(join(input.cwd, "implicit-ran"))).rejects.toMatchObject({ code: "ENOENT" });
      if (input.role === "implementer") {
        expect(input.prompt).toContain("originalFeature");
        await writeFile(join(input.cwd, "src", "main.ts"), "export function upstreamFeature() { return 2; }\n");
      } else {
        expect(input.prompt).toContain("upstreamFeature");
        expect(input.prompt).not.toContain('"name":"originalFeature"');
        expect(await readFile(join(input.cwd, "src", "main.ts"), "utf8")).toContain("upstreamFeature");
      }
      return { threadId: `fixture-${inputs.length}`, report: { summary: "Observed clone context", ...(input.role === "reviewer" ? { verdict: "approved", findings: [] } : {}) }, eventsObserved: 0 };
    };
    service = await ManagedRunService.open(root, { worker });
    const started = await service.execute("run-start", { requestId: "repo-context", goal: "Change feature and review", scope: ["src"], publish: false, environment: { mode: "none" },
      workflow: { workflowId: "repo-context", nodes: [
        { nodeId: "write", kind: "activity", dependsOn: [], required: true, inputDigest: managedDigest("write") },
        { nodeId: "review", kind: "activity", dependsOn: ["write"], required: true, inputDigest: managedDigest("review") },
      ] }, executors: [
        { nodeId: "write", type: "codex", role: "implementer", prompt: "Change feature", writeScope: ["src"] },
        { nodeId: "review", type: "codex", role: "reviewer", prompt: "Review feature" },
      ] }) as { runId: string };
    let state: any;
    const deadline = Date.now() + 20000;
    do {
      state = await service.execute("run-status", { runId: started.runId });
      if (["completed", "blocked", "failed"].includes(state.status)) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    expect({ status: state.status, error: state.error, steps: state.steps }).toMatchObject({ status: "completed" });
    expect(inputs).toHaveLength(2);
    expect(state.steps[0].repositoryContext.snapshotId).not.toBe(state.steps[1].repositoryContext.snapshotId);
    for (const step of state.steps) {
      expect(step.repositoryContext.sourceRoot).toBe(service.root);
      expect(step.repositoryContext.cloneRoot).toBe(step.directory);
      expect(step.repositoryContext.status).toBe("ready");
    }
    expect(await readFile(join(root, "src", "main.ts"), "utf8")).toContain("originalFeature");
    await expect(access(join(root, ".forge", "repository"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await service?.close(); await rm(root, { recursive: true, force: true }); }
}, 30000);

test("portable analysis helper preserves explicit non-Git target and shared runtime", async () => {
  const root = await fixture();
  try {
    const runtime = join(root, "fake-runtime.mjs");
    await writeFile(runtime, "console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}))");
    const output = execFileSync("node", [resolve(".agents/skills/forge-agent-fabric/scripts/repository.mjs"), "--project", root, "manifest", "discover", "--json"], {
      cwd: resolve("."), env: { ...process.env, FORGE_FABRIC_CLI: runtime }, encoding: "utf8", windowsHide: true,
    });
    const observed = JSON.parse(output);
    expect(observed.cwd).toBe(root);
    expect(observed.args).toEqual(["manifest", "discover", "--json", "--root", root, "--no-delta"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("portable CAIR helper binds an external manifesto to the explicit non-Git project", async () => {
  const root = await fixture();
  const external = await mkdtemp(join(tmpdir(), "forge-repo-external-manifest-"));
  try {
    const config = join(external, "analysis.json");
    await writeFile(config, JSON.stringify(manifest));
    const helper = resolve(".agents/skills/forge-agent-fabric/scripts/repository.mjs");
    const options = { cwd: resolve("."), env: { ...process.env, FORGE_FABRIC_CLI: resolve("bin/forge.mjs") }, encoding: "utf8" as const, windowsHide: true };
    const analysis = JSON.parse(execFileSync("node", [helper, "--project", root, "repository", "analyze", "--manifest", config, "--write", "--json"], options));
    expect(analysis.ok).toBe(true);
    const cair = JSON.parse(execFileSync("node", [helper, "--project", root, "cair", "query", "Q S name=originalFeature", "--manifest", config, "--json"], options));
    expect(cair.ok).toBe(true);
    const result = cair.observations.find((item: any) => item.code === "O REPOSITORY").data;
    expect(result.provider).toBe("repository");
    expect(result.snapshotId).toBe(analysis.snapshotId);
    expect(JSON.stringify(cair)).toContain("originalFeature");
    await expect(access(join(root, ".forge", "delta"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await rm(root, { recursive: true, force: true }); await rm(external, { recursive: true, force: true }); }
}, 30000);

test("changing source manifest after capture prevents publishing against obsolete analysis configuration", async () => {
  const root = await fixture();
  try {
    git(root, ["init", "-q"]); git(root, ["add", "."]);
    git(root, ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify(manifest));
    const base = await captureManagedBase(root, "manifest-source-gate", ["src"]);
    expect(base.contextScope).toContain("forge.manifest.json");
    const prepared = await prepareManagedWorkspace(base, "manifest-attempt", []);
    await writeFile(join(prepared.directory, "src", "main.ts"), "export function changedFeature() { return 3; }\n");
    const artifact = await captureManagedArtifact(base, prepared.directory, ["src"], prepared.inputDigest);
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify({ ...manifest, exclude: ["**/*.java"] }));
    await expect(publishManagedArtifacts(base, [artifact])).rejects.toThrow("source changed since capture");
    expect(await readFile(join(root, "src", "main.ts"), "utf8")).toContain("originalFeature");
  } finally { await rm(root, { recursive: true, force: true }); }
});
