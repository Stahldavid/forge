import { expect, test } from "bun:test";
import { claudeProgramArguments, claudeProgramResult, claudeProgramUsage, claudeProgramCapabilities, validateClaudeProgramVersion } from "../../src/forge/agent-fabric/claude-program-worker.ts";
import { runTypedCodexWorker, type CodexWorkerEvent, type CodexWorkerFactory } from "../../src/forge/agent-fabric/codex-sdk-worker.ts";
import type { Input } from "@openai/codex-sdk";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { captureManagedBase } from "../../src/forge/agent-fabric/managed-workspace.ts";
import { prepareProgramWorker, programWorkerInvocationDigest, type ProgramWorkerInput } from "../../src/forge/agent-fabric/program-worker.ts";
import type { ProgramWorkerObservation } from "../../src/forge/agent-fabric/program-observation.ts";

test("native Claude protocol constrains tool surface and rejects incomplete completion", () => {
  const args = claudeProgramArguments({ schema: { type: "object" }, writable: true });
  expect(args).toContain("--restricted"); expect(args).toContain("--strict-mcp-config"); expect(args).not.toContain("--dangerously-skip-permissions");
  expect(args[args.indexOf("--tools") + 1]).toBe("Read,Glob,Grep,Edit,Write");
  expect(claudeProgramCapabilities.processTreeTermination).toBe(false);
  expect(claudeProgramResult({ type: "result", subtype: "success", structured_output: { ok: true }, usage: { input_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 2, output_tokens: 1 } })).toEqual({ data: { ok: true }, usage: { input_tokens: 9, cached_input_tokens: 4, output_tokens: 1 } });
  expect(() => claudeProgramResult({ type: "result", subtype: "success", result: "{}" })).toThrow();
  expect(() => claudeProgramResult({ type: "result", subtype: "success", structured_output: {}, usage: { input_tokens: -1, output_tokens: 0 } })).toThrow();
  const failed = { type: "result", subtype: "error_max_turns", is_error: true, usage: { input_tokens: 11, output_tokens: 4 } };
  expect(claudeProgramUsage(failed)).toEqual({ input_tokens: 11, cached_input_tokens: 0, output_tokens: 4 });
  expect(() => claudeProgramResult(failed)).toThrow();
  expect(validateClaudeProgramVersion("2.1.259 (Claude Code)")).toBe("2.1.259");
  expect(() => validateClaudeProgramVersion("2.1.258 (Claude Code)")).toThrow();
  expect(() => validateClaudeProgramVersion("unknown CLI")).toThrow();
});

test("typed SDK supplies native images and persists usage before invalid output", async () => {
  const events: CodexWorkerEvent[] = []; let delivered: Input | undefined;
  const factory: CodexWorkerFactory = () => {
    const thread = { id: "resume-fixture", async runStreamed(content: Input) {
      delivered = content;
      return { events: (async function* () {
        yield { type: "turn.started" as const };
        yield { type: "item.completed" as const, item: { id: "answer", type: "agent_message" as const, text: "not-json" } };
        yield { type: "turn.completed" as const, usage: { input_tokens: 7, cached_input_tokens: 2, output_tokens: 1, cache_write_input_tokens: 0, reasoning_output_tokens: 0 } };
      })() };
    } };
    return { startThread: () => { throw new Error("Expected resumed thread"); }, resumeThread: id => { expect(id).toBe("resume-fixture"); return thread; } };
  };
  await expect(runTypedCodexWorker({ cwd: process.cwd(), prompt: "fixture", role: "reviewer", threadId: "resume-fixture", images: [{ path: "fixture.png" }], signal: new AbortController().signal, onEvent: event => { events.push(event); }, outputSchema: {}, validateOutput: () => {} }, factory)).rejects.toMatchObject({ code: "AF_CODEX_REPORT" });
  expect(delivered).toEqual([{ type: "text", text: "fixture\nReturn only data matching the requested output schema. Never include credentials." }, { type: "local_image", path: "fixture.png" }]);
  expect(events.some(event => event.type === "input.images.delivered")).toBe(true);
  expect(events.find(event => event.usage)?.usage?.input_tokens).toBe(7);
});

test("prepared input fingerprint binds context content and evidence even when snapshot identity is unchanged", () => {
  const invocation = { workspace: "workspace", binaryDigest: "binary", dependencies: { lock: "lock", content: "dependencies" }, environment: "environment",
    executor: { id: "fixture", version: "1", kind: "codex", role: "investigator", effect: "read", timeoutMs: 1000, writeScope: [], network: "disabled", isolation: "sandbox", schema: { id: "any", version: "1" } } as ProgramWorkerInput["executor"],
    data: { task: "fixture" }, scope: [], repository: { metadata: { snapshotId: "same-source", runtime: { reportId: "observation-a" } }, prompt: "Source evidence A" },
    evidence: [{ receiptId: "receipt", bytes: new Uint8Array([1]), mime: "image/png", itemKey: "page" }],
  };
  const original = programWorkerInvocationDigest(invocation);
  expect(programWorkerInvocationDigest(structuredClone(invocation))).toBe(original);
  expect(programWorkerInvocationDigest({ ...invocation, repository: { ...invocation.repository, prompt: "Source evidence B" } })).not.toBe(original);
  expect(programWorkerInvocationDigest({ ...invocation, repository: { metadata: { snapshotId: "same-source", runtime: { reportId: "observation-b" } }, prompt: invocation.repository.prompt } })).not.toBe(original);
  expect(programWorkerInvocationDigest({ ...invocation, evidence: [{ ...invocation.evidence[0]!, bytes: new Uint8Array([2]) }] })).not.toBe(original);
});

test("command protocol preserves UTF-8 JSON split across stdout chunks", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-command-utf8-test-")), owned = [root];
  const observations: ProgramWorkerObservation[] = [];
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: "ignore" });
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    await mkdir(join(root, "src")); await writeFile(join(root, "src", "a.txt"), "baseline");
    git("add", "."); git("commit", "-qm", "baseline");
    const base = await captureManagedBase(root, "unicode-fixture", ["src"]); owned.push(dirname(base.baselineDirectory));
    const schema = { id: "output", version: "1" };
    const worker = await prepareProgramWorker({
      executor: { id: "fixture", version: "1", kind: "command", role: "investigator", effect: "read", timeoutMs: 30000, writeScope: [], network: "host", isolation: "cooperative", schema, tokenAccounting: "none",
        argv: [process.execPath, "-e", "const b=Buffer.from(JSON.stringify({value:'ação'})); const i=b.indexOf(0xc3)+1; process.stdout.write(b.subarray(0,i)); setTimeout(()=>process.stdout.write(b.subarray(i)),30)"] },
      data: {}, artifacts: [], base, attemptId: "attempt-unicode", scope: [], signal: new AbortController().signal,
      registry: { schemas: { "output@1": { type: "object", properties: { value: { type: "string" } }, required: ["value"] } }, executors: {}, policies: {}, acceptance: {}, populations: {} },
      onThread: async () => { throw new Error("Command fixture must not start an SDK thread"); },
      onObservation: async observation => { observations.push(observation); },
    }); owned.push(dirname(worker.directory));
    const result = await worker.execute();
    expect(result.outcome).toBe("completed"); expect(result.data).toEqual({ value: "ação" });
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("baseline");
    for (const phase of ["preparation.workspace", "preparation.environment", "preparation.capture", "execution.finished", "capture.finished"]) {
      const elapsed = observations.find(observation => observation.type === phase)?.metadata?.phaseElapsedMs;
      expect(typeof elapsed).toBe("number"); expect(Number.isFinite(elapsed)).toBe(true); expect(Number(elapsed)).toBeGreaterThanOrEqual(0);
    }
  } finally {
    for (const path of owned.reverse()) {
      const relation = relative(resolve(tmpdir()), resolve(path));
      if (!relation || relation.startsWith("..") || isAbsolute(relation) || !relation.startsWith("forge-")) throw new Error("Fixture cleanup escaped owned temporary directories");
      await rm(path, { recursive: true, force: true });
    }
  }
}, 30000);

test("real managed recovery rejects changed source delta and incompatible invocation before execution", async () => {
  const root = await mkdtemp(join(tmpdir(), "forge-program-recovery-test-")), owned = [root];
  const priorMode = process.env.FORGE_FABRIC_TEST_MODE;
  // This fixture only prepares inputs and hashes the installed SDK/binary. It never calls execute().
  delete process.env.FORGE_FABRIC_TEST_MODE;
  try {
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: "ignore" });
    git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid");
    await mkdir(join(root, "src")); await writeFile(join(root, "src", "a.txt"), "baseline");
    await writeFile(join(root, "src", "main.ts"), "export const ready = true;\n");
    await writeFile(join(root, "forge.manifest.json"), JSON.stringify({ forgeProtocol: "2.0", kind: "repository", components: [{ id: "app", root: "src", adapters: ["typescript"] }] }));
    git("add", "."); git("commit", "-qm", "baseline");
    const base = await captureManagedBase(root, "recovery-fixture", ["src"]); owned.push(dirname(base.baselineDirectory));
    const schema = { id: "output", version: "1" };
    const input: ProgramWorkerInput = {
      executor: { id: "fixture", version: "1", kind: "codex", role: "investigator", effect: "read", timeoutMs: 30000, writeScope: [], network: "disabled", isolation: "sandbox", schema },
      data: { task: "fixture" }, artifacts: [], base, attemptId: "attempt-original", scope: [], signal: new AbortController().signal,
      registry: { schemas: { "output@1": { type: "object" } }, executors: {}, policies: {}, acceptance: {}, populations: {} },
      onThread: async () => { throw new Error("No SDK thread may start during preparation fixture"); },
    };
    const prepared = await prepareProgramWorker(input); owned.push(dirname(prepared.directory));
    expect(prepared.recovery).toBeDefined();
    const recovery = { ...prepared.recovery!, threadId: "fixture-thread", terminationObserved: true as const, generationCompatible: true as const };
    const compatible = await prepareProgramWorker({ ...input, attemptId: "attempt-compatible", recovery });
    expect(compatible.inputDigest).toBe(prepared.inputDigest);
    await writeFile(join(prepared.directory, "src", "a.txt"), "unobserved partial change");
    await expect(prepareProgramWorker({ ...input, attemptId: "attempt-resume", recovery })).rejects.toThrow("Recovery workspace changed after reconciliation");
    await writeFile(join(prepared.directory, "src", "a.txt"), "baseline");
    const marker = join(prepared.directory, ".git", "forge-program-recovery.json");
    const original = await readFile(marker, "utf8");
    await writeFile(marker, JSON.stringify({ invocationDigest: `sha256:${"0".repeat(64)}` }));
    await expect(prepareProgramWorker({ ...input, attemptId: "attempt-resume", recovery })).rejects.toThrow("Recovery invocation changed");
    expect(await readFile(join(root, "src", "a.txt"), "utf8")).toBe("baseline");
    await writeFile(marker, original);
  } finally {
    if (priorMode === undefined) delete process.env.FORGE_FABRIC_TEST_MODE; else process.env.FORGE_FABRIC_TEST_MODE = priorMode;
    for (const path of owned.reverse()) {
      const relation = relative(resolve(tmpdir()), resolve(path));
      if (!relation || relation.startsWith("..") || isAbsolute(relation) || !relation.startsWith("forge-")) throw new Error("Fixture cleanup escaped owned temporary directories");
      await rm(path, { recursive: true, force: true });
    }
  }
}, 60000);
