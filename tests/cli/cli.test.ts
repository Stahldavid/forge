import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseCli, hasUnknownOption } from "../../src/forge/cli/parse.ts";
import { buildCheckJson } from "../../src/forge/cli/output.ts";
import { classifyChangeType } from "../../src/forge/workspace/change-summary.ts";
import { main } from "../../src/forge/cli/main.ts";
import { resolveBunExecutable } from "../../src/forge/cli/bun-exec.ts";
import { runGenerateCommand } from "../../src/forge/cli/commands.ts";
import {
  probeStudioPreview,
  runStudioAttachCommand,
  runStudioBridgeCommand,
  runStudioCodexServerCommand,
  runStudioOpenCommand,
  runStudioSnapshotCommand,
  runStudioWatchCommand,
} from "../../src/forge/cli/studio.ts";
import {
  buildStrictTestGraphPlan,
  chunkFiles,
  classifyStrictTestFile,
  packWeightedStrictTestChunks,
  resolveStrictIsolatedTestJobs,
  resolveStrictTestJobs,
} from "../../src/forge/cli/verify.ts";
import { cleanupWorkspace, scaffoldGenerateWorkspace } from "../orchestrator/helpers.ts";

async function listenOnRandomPort(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate test port");
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

describe("Forge CLI", () => {
  test("runGenerateCommand respects workspaceRoot when cwd differs", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-generate-workspace-root");
    const otherCwd = mkdtempSync(join(tmpdir(), "forge-generate-cwd-"));
    const previousCwd = process.cwd();
    try {
      const write = await runGenerateCommand({
        workspaceRoot: workspace,
        check: false,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      expect(write.exitCode).toBe(0);

      process.chdir(otherCwd);
      const check = await runGenerateCommand({
        workspaceRoot: workspace,
        check: true,
        dryRun: false,
        json: true,
        concurrency: 2,
      });
      expect(check.exitCode).toBe(0);
      expect(check.changed).toEqual([]);
      expect(process.cwd()).toBe(otherCwd);
    } finally {
      process.chdir(previousCwd);
      cleanupWorkspace(workspace);
      rmSync(otherCwd, { recursive: true, force: true });
    }
  });

  test("parseCli rejects unsupported inspect target", () => {
    const parsed = parseCli(["inspect", "unknown"]);
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.command).toBeNull();
  });

  test("parseCli defaults bare inspect to summary", () => {
    const parsed = parseCli(["inspect", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command).toMatchObject({
      kind: "inspect",
      target: "summary",
      json: true,
    });
  });

  test("parseCli accepts supported inspect targets", () => {
    for (const target of [
      "app",
      "packages",
      "capabilities",
      "runtime-matrix",
      "data",
      "runtime",
      "dev",
      "agent-contract",
      "summary",
      "schema",
      "drift",
      "handoff",
      "framework",
      "imported",
    ]) {
      const parsed = parseCli(["inspect", target]);
      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("inspect");
    }
  });

  test("parseCli accepts brownfield import commands", () => {
    const analyze = parseCli(["import", "analyze", "--json", "--dry-run"]);
    expect(analyze.errors).toEqual([]);
    expect(analyze.command?.kind).toBe("import");
    if (analyze.command?.kind === "import") {
      expect(analyze.command.options.subcommand).toBe("analyze");
      expect(analyze.command.options.dryRun).toBe(true);
    }

    const inspect = parseCli(["import", "inspect", "--entry", "users.read", "--target", "candidate-entries", "--json"]);
    expect(inspect.errors).toEqual([]);
    expect(inspect.command?.kind).toBe("import");
    if (inspect.command?.kind === "import") {
      expect(inspect.command.options.subcommand).toBe("inspect");
      expect(inspect.command.options.entry).toBe("users.read");
      expect(inspect.command.options.target).toBe("candidate-entries");
    }
  });

  test("parseCli accepts status, changed, and handoff", () => {
    const parsed = parseCli(["status", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("status");
    if (parsed.command?.kind === "status") {
      expect(parsed.command.json).toBe(true);
    }

    const changed = parseCli(["changed", "--json"]);
    expect(changed.errors).toEqual([]);
    expect(changed.command?.kind).toBe("changed");
    if (changed.command?.kind === "changed") {
      expect(changed.command.json).toBe(true);
    }

    const authoredChanged = parseCli(["changed", "--authored", "--json"]);
    expect(authoredChanged.errors).toEqual([]);
    expect(authoredChanged.command?.kind).toBe("changed");
    if (authoredChanged.command?.kind === "changed") {
      expect(authoredChanged.command.authoredOnly).toBe(true);
    }

    const diff = parseCli(["diff", "authored", "--json"]);
    expect(diff.errors).toEqual([]);
    expect(diff.command).toMatchObject({ kind: "diff", target: "authored", json: true });

    const handoff = parseCli(["handoff", "--json"]);
    expect(handoff.errors).toEqual([]);
    expect(handoff.command?.kind).toBe("handoff");
    if (handoff.command?.kind === "handoff") {
      expect(handoff.command.json).toBe(true);
    }
  });

  test("parseCli accepts docs check and classifies tracked Codex hooks as config", () => {
    const parsed = parseCli(["docs", "check", "--json"]);
    expect(parsed.command).toMatchObject({
      kind: "docs",
      subcommand: "check",
      json: true,
    });
    expect(classifyChangeType(".codex/hooks.json")).toBe("config");
  });

  test("check JSON success does not recommend running check again", () => {
    const json = buildCheckJson({
      changed: [],
      unchanged: [],
      warnings: [],
      errors: [],
      exitCode: 0,
    });
    expect(json.nextActions).not.toContain("forge check --json");
    expect(json.nextActions).toContain("forge verify --changed");
  });

  test("parseCli accepts explicit human status output", () => {
    expect(hasUnknownOption(["status", "--human"])).toBeNull();
    const parsed = parseCli(["status", "--human"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("status");
  });

  test("parseCli accepts studio attach for external agent workrooms", () => {
    const parsed = parseCli([
      "studio",
      "attach",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--target",
      "codex",
      "--target",
      "claude",
      "--json",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("studio");
    if (parsed.command?.kind === "studio") {
      expect(parsed.command.subcommand).toBe("attach");
      expect(parsed.command.path).toBe("C:/work/customer-app");
      expect(parsed.command.previewPort).toBe(5174);
      expect(parsed.command.targets).toEqual(["codex", "claude"]);
      expect(parsed.command.json).toBe(true);
    }

    const noPath = parseCli(["studio", "attach", "--target", "codex", "--json"]);
    expect(noPath.errors).toEqual([]);
    expect(noPath.command?.kind).toBe("studio");
    if (noPath.command?.kind === "studio") {
      expect(noPath.command.path).toBeUndefined();
      expect(noPath.command.targets).toEqual(["codex"]);
    }
  });

  test("parseCli accepts studio snapshot for observer state", () => {
    const parsed = parseCli([
      "studio",
      "snapshot",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--target",
      "codex",
      "--json",
    ]);

    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("studio");
    if (parsed.command?.kind === "studio") {
      expect(parsed.command.subcommand).toBe("snapshot");
      expect(parsed.command.path).toBe("C:/work/customer-app");
      expect(parsed.command.previewPort).toBe(5174);
      expect(parsed.command.targets).toEqual(["codex"]);
      expect(parsed.command.json).toBe(true);
    }
  });

  test("parseCli accepts studio open, watch, bridge, doctor, and codex-server", () => {
    for (const subcommand of ["open", "watch", "bridge", "doctor", "codex-server"] as const) {
      const parsed = parseCli([
        "studio",
        subcommand,
        "C:/work/customer-app",
        "--preview-port",
        "5174",
        "--studio-url",
        "http://127.0.0.1:3765",
        "--interval-ms",
        "2000",
        "--target",
        "codex",
        "--workspace-id",
        "workspace_1",
        "--tenant-id",
        "tenant_1",
        "--user-id",
        "user_1",
        "--role",
        "owner",
        "--once",
        "--json",
      ]);

      expect(parsed.errors).toEqual([]);
      expect(parsed.command?.kind).toBe("studio");
      if (parsed.command?.kind === "studio") {
        expect(parsed.command.subcommand).toBe(subcommand);
        expect(parsed.command.path).toBe("C:/work/customer-app");
        expect(parsed.command.previewPort).toBe(5174);
        expect(parsed.command.studioUrl).toBe("http://127.0.0.1:3765");
        expect(parsed.command.intervalMs).toBe(2000);
        expect(parsed.command.workspaceId).toBe("workspace_1");
        expect(parsed.command.tenantId).toBe("tenant_1");
        expect(parsed.command.userId).toBe("user_1");
        expect(parsed.command.role).toBe("owner");
        expect(parsed.command.once).toBe(true);
        expect(parsed.command.writeSchemas).toBe(false);
        expect(parsed.command.probeAppServer).toBe(false);
        expect(parsed.command.targets).toEqual(["codex"]);
      }
    }

    const codexServer = parseCli(["studio", "codex-server", ".", "--write", "--probe", "--json"]);
    expect(codexServer.errors).toEqual([]);
    expect(codexServer.command?.kind).toBe("studio");
    if (codexServer.command?.kind === "studio") {
      expect(codexServer.command.subcommand).toBe("codex-server");
      expect(codexServer.command.writeSchemas).toBe(true);
      expect(codexServer.command.probeAppServer).toBe(true);
    }

    expect(hasUnknownOption(["studio", "open", "--install", "--no-start", "--no-bridge", "--probe-codex-server"])).toBeNull();
    const open = parseCli([
      "studio",
      "open",
      "C:/work/customer-app",
      "--preview-port",
      "5174",
      "--probe-codex-server",
      "--install",
      "--no-start",
      "--no-bridge",
      "--json",
    ]);
    expect(open.errors).toEqual([]);
    expect(open.command?.kind).toBe("studio");
    if (open.command?.kind === "studio") {
      expect(open.command.subcommand).toBe("open");
      expect(open.command.install).toBe(true);
      expect(open.command.start).toBe(false);
      expect(open.command.bridge).toBe(false);
      expect(open.command.probeAppServer).toBe(true);
    }
  });

  test("parseCli accepts forge add frontend and backend package targets", () => {
    const frontend = parseCli(["add", "lucide-react", "--frontend", "--json"]);
    expect(frontend.errors).toEqual([]);
    expect(frontend.command?.kind).toBe("add");
    if (frontend.command?.kind === "add") {
      expect(frontend.command.alias).toBe("lucide-react");
      expect(frontend.command.options.packageTarget).toBe("frontend");
      expect(frontend.command.options.json).toBe(true);
    }

    const backend = parseCli(["add", "hono", "--backend"]);
    expect(backend.errors).toEqual([]);
    expect(backend.command?.kind).toBe("add");
    if (backend.command?.kind === "add") {
      expect(backend.command.options.packageTarget).toBe("backend");
    }
  });

  test("studio attach dry-run plans the target app preview and agent setup", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-attach-"));
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", forge: { template: "minimal-web" } }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex", "claude"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.app.name).toBe("customer-app");
      expect(result.app.template).toBe("minimal-web");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.preview.source).toBe("preview-port");
      expect(result.preview.isStudioSelfPreview).toBe(false);
      expect(result.preview.status).toMatchObject({
        state: "not-checked",
        checked: false,
      });
      expect(result.preview.status.suggestedCommands).toContain("forge dev --port 3766 --web-port 5174");
      expect(result.posture).toMatchObject({
        checked: false,
        state: "not-checked",
      });
      expect(result.posture.recommendedCommands).toContain("forge dev --once --json");
      expect(result.filesPlanned).toContain(".forge/studio/attachment.json");
      expect(result.filesWritten).toEqual([]);
      expect(result.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5174");
      expect(result.commands.startTargetAppCwd).toBe(workspace.replace(/\\/g, "/"));
      expect(result.commands.openPreview).toBe("http://127.0.0.1:5174");
      expect(result.commands.probePreview).toBe("forge dev --once --json");
      expect(result.commands.installHooks).toContain("forge agent onboard --target codex --json");
      expect(result.commands.installHooks).toContain("forge agent onboard --target claude --json");

      const avoided = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5173,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(avoided.ok).toBe(true);
      expect(avoided.preview).toMatchObject({
        url: "http://127.0.0.1:5174",
        port: 5174,
        requestedUrl: "http://127.0.0.1:5173",
        requestedPort: 5173,
        source: "studio-avoid-self-preview",
        isStudioSelfPreview: true,
      });
      expect(avoided.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_SELF_PREVIEW_AVOIDED")).toBe(true);
      expect(avoided.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5174");
      expect(avoided.commands.openPreview).toBe("http://127.0.0.1:5174");
      expect(avoided.preview.status.state).toBe("not-checked");

      const forced = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewUrl: "http://127.0.0.1:5173",
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: true,
      });
      expect(forced.preview).toMatchObject({
        url: "http://127.0.0.1:5173",
        port: 5173,
        source: "explicit-url",
        isStudioSelfPreview: true,
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio attach records ForgeOS posture for real attached apps", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-attach-posture");
    try {
      const result = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: [],
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.filesWritten).toContain(".forge/studio/attachment.json");
      expect(result.posture).toMatchObject({
        checked: true,
        state: "ready",
        safeToEdit: true,
      });
      expect(result.posture.generated?.state).toMatch(/fresh|regenerated/);
      expect(result.posture.diffPlan).toMatchObject({
        first: "authored",
        then: "generated",
        authoredDiffCommand: 'git diff -- . ":(exclude)src/forge/_generated/**" ":(exclude)forge.lock"',
      });
      const manifest = JSON.parse(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).text()) as {
        posture?: typeof result.posture;
      };
      expect(manifest.posture?.generated?.state).toBe(result.posture.generated?.state);
      expect(manifest.posture?.diffPlan?.fullDiffCommand).toBe("git diff");
    } finally {
      cleanupWorkspace(workspace);
    }
  });

  test("studio open dry-run plans attach, preview automation, and bridge", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-open-"));
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", packageManager: "npm@10.0.0", forge: { template: "minimal-web" } }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("open");
      expect(result.attach.action).toBe("attach");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        skippedReason: "dry-run",
      });
      expect(result.previewAutomation.install).toMatchObject({
        required: true,
        installed: false,
        attempted: false,
        command: "npm install",
      });
      expect(result.bridge).toMatchObject({
        attempted: true,
        ok: true,
        posted: false,
        dryRun: true,
        studioUrl: "http://127.0.0.1:3765",
      });
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5174 --target codex --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json");
      expect(result.nextActions).toContain("npm install");
      expect(result.nextActions).toContain("forge dev --port 3766 --web-port 5174");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio open does not start preview when dependencies are missing without install consent", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-open-missing-deps-"));
    const listener = await listenOnRandomPort();
    const previewPort = listener.port;
    await listener.close();
    try {
      writeFileSync(
        join(workspace, "package.json"),
        `${JSON.stringify({ name: "customer-app", packageManager: "bun@1.3.14" }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort,
        targets: ["codex"],
        bridge: false,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(false);
      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        skippedReason: "missing-dependencies",
      });
      expect(result.previewAutomation.install).toMatchObject({
        required: true,
        installed: false,
        attempted: false,
        command: "bun install",
      });
      expect(result.bridge.attempted).toBe(false);
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_DEPENDENCIES_MISSING")).toBe(true);
      expect(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).exists()).toBe(true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("studio open reuses a live target preview process instead of spawning a duplicate", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-open-preview-state");
    try {
      mkdirSync(join(workspace, ".forge", "studio"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "studio", "preview.json"),
        `${JSON.stringify({
          pid: process.pid,
          command: "forge dev --port 3766 --web-port 5174",
          previewPort: 5174,
          runtimePort: 3766,
          startedAt: new Date(0).toISOString(),
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioOpenCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        bridge: false,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.previewAutomation).toMatchObject({
        attempted: false,
        started: false,
        alreadyRunning: true,
        skippedReason: "already-running",
        pid: process.pid,
        owner: {
          kind: "forge-managed",
          pid: process.pid,
          statePath: ".forge/studio/preview.json",
        },
      });
      expect(result.previewAutomation.statusAfter.state).toBe("not-running");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot reports preview posture and changed state without writing manifest", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-snapshot");
    try {
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(false);
      expect(result.action).toBe("snapshot");
      expect(result.preview.url).toBe("http://127.0.0.1:5174");
      expect(result.posture).toMatchObject({
        checked: true,
        state: "needs-attention",
        safeToEdit: false,
      });
      expect(result.posture.generated?.state).toBe("stale-risk");
      expect(Number((result.changed.summary as { changedFiles?: number }).changedFiles)).toBeGreaterThanOrEqual(0);
      expect(result.changed.diffPlan).toMatchObject({
        first: "authored",
        then: "generated",
      });
      expect(result.contextPacket.commands).toContain("forge changed --json");
      expect(result.proofs.hooks[0]?.target).toBe("codex");
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5174 --target codex --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5174 --target codex --studio-url http://127.0.0.1:3765 --json");
      expect(result.commands.doctor).toBe("forge studio doctor . --preview-port 5174 --target codex --json");
      expect(result.nextActions).toContain("forge changed --json");
      expect(await Bun.file(join(workspace, ".forge", "studio", "attachment.json")).exists()).toBe(false);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot exposes Codex app-server proof without requiring it", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-app-server");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.proofs.codexAppServer).toMatchObject({
        checked: true,
        relevant: true,
        state: "disabled",
        available: false,
      });
      expect(result.commands.codexAppServer?.inspect).toBe("codex app-server --help");
      expect(result.commands.codexAppServer?.generateTypes).toBe("codex app-server generate-ts --out .forge/codex-app-server-schemas");
      expect(result.contextPacket.commands).toContain("codex app-server --help");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot can include Codex app-server handshake proof when requested", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-app-server-probe");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        probeAppServer: true,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.proofs.codexAppServer).toMatchObject({
        checked: true,
        relevant: true,
        state: "disabled",
        available: false,
        handshake: {
          attempted: false,
          ok: true,
          initialized: false,
          skippedReason: "disabled",
        },
      });
      expect(result.commands.bridge).toContain("--probe-codex-server");
      expect(result.commands.doctor).toContain("--probe-codex-server");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio codex-server reports the optional app-server surface directly", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-server-command");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioCodexServerCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("codex-server");
      expect(result.proof.state).toBe("disabled");
      expect(result.schemaGeneration).toMatchObject({
        attempted: false,
        dryRun: true,
        ok: true,
      });
      expect(result.handshake).toMatchObject({
        attempted: false,
        ok: true,
        skippedReason: "not-requested",
      });
      expect(result.commands.connectStdio).toBe("codex app-server");
      expect(result.commands.probeHandshake).toBe("forge studio codex-server . --probe --json");
      expect(result.nextActions).toContain("codex app-server --help");
      expect(result.nextActions).toContain("forge studio codex-server . --probe --json");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio codex-server --probe skips cleanly when app-server probing is disabled", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-codex-server-probe-disabled");
    const original = process.env.FORGE_CODEX_APP_SERVER;
    try {
      process.env.FORGE_CODEX_APP_SERVER = "off";
      const result = await runStudioCodexServerCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        probeAppServer: true,
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.handshake).toMatchObject({
        attempted: false,
        dryRun: false,
        ok: true,
        skippedReason: "disabled",
        initialized: false,
      });
      expect(result.nextActions).not.toContain("forge studio codex-server . --probe --json");
    } finally {
      if (original === undefined) delete process.env.FORGE_CODEX_APP_SERVER;
      else process.env.FORGE_CODEX_APP_SERVER = original;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot reuses existing attachment preview and targets", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-snapshot-attachment");
    try {
      mkdirSync(join(workspace, ".forge", "studio"), { recursive: true });
      writeFileSync(
        join(workspace, ".forge", "studio", "attachment.json"),
        `${JSON.stringify({
          schemaVersion: "0.1.0",
          preview: {
            url: "http://127.0.0.1:5199",
            port: 5199,
            source: "preview-port",
            isStudioSelfPreview: false,
            note: "Attached preview",
            status: {
              state: "not-checked",
              checked: false,
              reason: "seeded",
              suggestedCommands: [],
            },
          },
          targets: ["codex", "claude"],
        }, null, 2)}\n`,
        "utf8",
      );

      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.preview.url).toBe("http://127.0.0.1:5199");
      expect(result.preview.port).toBe(5199);
      expect(result.targets).toEqual(["codex", "claude"]);
      expect(result.commands.startTargetApp).toBe("forge dev --port 3766 --web-port 5199");
      expect(result.commands.attach).toBe("forge studio attach . --preview-port 5199 --target codex --target claude --json");
      expect(result.commands.bridge).toBe("forge studio bridge . --preview-port 5199 --target codex --target claude --studio-url http://127.0.0.1:3765 --json");
      expect(result.commands.checkHooks).toContain("forge agent hooks status --target claude --json");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio snapshot tolerates ready non-git workspaces", async () => {
    const sourceWorkspace = scaffoldGenerateWorkspace("forge-studio-snapshot-no-git");
    const workspace = mkdtempSync(join(tmpdir(), "forge-studio-snapshot-no-git-"));
    cpSync(sourceWorkspace, workspace, { recursive: true, force: true });
    cleanupWorkspace(sourceWorkspace);
    try {
      rmSync(join(workspace, ".git"), { recursive: true, force: true });
      const attach = await runStudioAttachCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: false,
        force: false,
      });
      expect(attach.ok).toBe(true);
      rmSync(join(workspace, ".git"), { recursive: true, force: true });

      const result = await runStudioSnapshotCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.posture.state).toBe("ready");
      expect((result.changed.git as { available?: boolean }).available).toBe(false);
      expect(result.changed.risks).toContain("git status is unavailable; changed-file analysis may be incomplete");
      expect(result.ok).toBe(true);
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio bridge dry-run collects and prepares a Studio ingest snapshot", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-bridge");
    try {
      const result = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: true,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.action).toBe("bridge");
      expect(result.mode).toBe("once");
      expect(result.studioUrl).toBe("http://127.0.0.1:3765");
      expect(result.endpoint).toBe("http://127.0.0.1:3765/commands/ingestStudioSnapshot");
      expect(result.provider).toBe("Codex");
      expect(result.target).toBe("codex");
      expect(result.intervalMs).toBe(2000);
      expect(result.posted).toBe(false);
      expect(result.dryRun).toBe(true);
      expect(result.snapshot.action).toBe("snapshot");
      expect(result.diagnostics.some((diagnostic) => diagnostic.code === "FORGE_STUDIO_BRIDGE_DRY_RUN")).toBe(true);

      const implicitOnce = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: false,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });
      expect(implicitOnce.mode).toBe("once");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio watch dry-run emits a single snapshot event", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-watch-dry-run");
    try {
      const result = await runStudioWatchCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        intervalMs: 2000,
        once: false,
        targets: ["codex"],
        json: true,
        dryRun: true,
        force: false,
      });

      expect(result.action).toBe("watch");
      expect(result.stream.mode).toBe("once");
      expect(result.stream.dryRun).toBe(true);
      expect(result.stream.intervalMs).toBe(2000);
      expect(result.snapshot.action).toBe("snapshot");
    } finally {
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio bridge posts with Forge Studio local dev auth defaults", async () => {
    const workspace = scaffoldGenerateWorkspace("forge-studio-bridge-auth");
    const originalFetch = globalThis.fetch;
    const originalTenant = process.env.FORGE_TENANT_ID;
    const originalUser = process.env.FORGE_USER_ID;
    const originalRole = process.env.FORGE_ROLE;
    let capturedHeaders: Headers | undefined;
    let capturedBody: Record<string, any> | undefined;

    try {
      delete process.env.FORGE_TENANT_ID;
      delete process.env.FORGE_USER_ID;
      delete process.env.FORGE_ROLE;

      globalThis.fetch = (async (_input, init) => {
        capturedHeaders = new Headers(init?.headers);
        capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, any>;
        return new Response(JSON.stringify({ ok: true, result: { workspaceId: "workspace_1" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;

      const result = await runStudioBridgeCommand({
        workspaceRoot: workspace,
        previewPort: 5174,
        studioUrl: "http://127.0.0.1:3765",
        intervalMs: 2000,
        once: true,
        targets: ["codex"],
        json: true,
        dryRun: false,
        force: false,
      });

      expect(result.ok).toBe(true);
      expect(result.posted).toBe(true);
      expect(capturedHeaders?.get("x-forge-tenant-id")).toBe("00000000-0000-4000-8000-000000000001");
      expect(capturedHeaders?.get("x-forge-user-id")).toBe("forge-studio-dev");
      expect(capturedHeaders?.get("x-forge-role")).toBe("owner");
      expect(capturedBody?.args?.provider).toBe("Codex");
      expect(capturedBody?.args?.snapshot?.action).toBe("snapshot");
      expect(capturedBody?.args?.bridge).toMatchObject({
        mode: "once",
        intervalMs: 2000,
        status: "received",
      });
      expect(typeof capturedBody?.args?.bridge?.postedAt).toBe("string");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalTenant === undefined) delete process.env.FORGE_TENANT_ID;
      else process.env.FORGE_TENANT_ID = originalTenant;
      if (originalUser === undefined) delete process.env.FORGE_USER_ID;
      else process.env.FORGE_USER_ID = originalUser;
      if (originalRole === undefined) delete process.env.FORGE_ROLE;
      else process.env.FORGE_ROLE = originalRole;
      cleanupWorkspace(workspace);
    }
  }, 20_000);

  test("studio preview probe reports local preview reachability", async () => {
    const listener = await listenOnRandomPort();
    try {
      const reachable = await probeStudioPreview(
        {
          url: `http://127.0.0.1:${listener.port}`,
          port: listener.port,
          source: "preview-port",
          isStudioSelfPreview: false,
          note: "test preview",
        },
        { dryRun: false, startCommand: `forge dev --web-port ${listener.port}`, timeoutMs: 500 },
      );
      expect(reachable).toMatchObject({
        state: "reachable",
        checked: true,
      });
    } finally {
      await listener.close();
    }

    const notChecked = await probeStudioPreview(
      {
        url: "https://example.com",
        source: "explicit-url",
        isStudioSelfPreview: false,
        note: "remote preview",
      },
      { dryRun: false, startCommand: "forge dev --web-port 5174", timeoutMs: 50 },
    );
    expect(notChecked).toMatchObject({
      state: "not-checked",
      checked: false,
    });
  });

  test("parseCli accepts explicit full inspect", () => {
    const parsed = parseCli(["inspect", "all", "--full", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("inspect");
    if (parsed.command?.kind === "inspect") {
      expect(parsed.command.target).toBe("all");
      expect(parsed.command.full).toBe(true);
    }

    const brief = parseCli(["inspect", "all", "--brief", "--json"]);
    expect(brief.errors).toEqual([]);
    expect(brief.command?.kind).toBe("inspect");
    if (brief.command?.kind === "inspect") {
      expect(brief.command.target).toBe("all");
      expect(brief.command.brief).toBe(true);
    }
  });

  test("parseCli accepts delta repair preview and confirmation flags", () => {
    const preview = parseCli(["delta", "repair", "--dry-run", "--json"]);
    expect(preview.errors).toEqual([]);
    expect(preview.command?.kind).toBe("delta");
    if (preview.command?.kind === "delta") {
      expect(preview.command.subcommand).toBe("repair");
      expect(preview.command.dryRun).toBe(true);
      expect(preview.command.yes).toBe(false);
      expect(preview.command.verbose).toBe(false);
    }

    const apply = parseCli(["delta", "repair", "--yes", "--json"]);
    expect(apply.errors).toEqual([]);
    expect(apply.command?.kind).toBe("delta");
    if (apply.command?.kind === "delta") {
      expect(apply.command.subcommand).toBe("repair");
      expect(apply.command.yes).toBe(true);
    }
  });

  test("parseCli accepts release doctor and prepared-only gates", () => {
    const releaseDoctor = parseCli(["release", "doctor", "--json"]);
    expect(releaseDoctor.errors).toEqual([]);
    expect(releaseDoctor.command).toMatchObject({ kind: "release", action: "doctor", json: true });

    const releaseCheck = parseCli(["release", "check", "--allow-missing-local-release", "--json"]);
    expect(releaseCheck.errors).toEqual([]);
    expect(releaseCheck.command?.kind).toBe("release");
    if (releaseCheck.command?.kind === "release") {
      expect(releaseCheck.command.allowMissingLocalRelease).toBe(true);
    }

    const selfHost = parseCli(["self-host", "check", "--prepared-only", "--json"]);
    expect(selfHost.errors).toEqual([]);
    expect(selfHost.command?.kind).toBe("self-host");
    if (selfHost.command?.kind === "self-host") {
      expect(selfHost.command.preparedOnly).toBe(true);
    }

    const docs = parseCli(["docs", "check", "--build", "--install-venv", "--json"]);
    expect(docs.errors).toEqual([]);
    expect(docs.command?.kind).toBe("docs");
    if (docs.command?.kind === "docs") {
      expect(docs.command.build).toBe(true);
      expect(docs.command.installVenv).toBe(true);
    }
  });

  test("parseCli accepts agent prepare, hook smoke, and db doctor", () => {
    const prepare = parseCli(["agent", "prepare", "--target", "codex", "--json"]);
    expect(prepare.errors).toEqual([]);
    expect(prepare.command?.kind).toBe("agent");
    if (prepare.command?.kind === "agent") {
      expect(prepare.command.options.subcommand).toBe("prepare");
      expect(prepare.command.options.target).toBe("codex");
    }

    const hooks = parseCli(["agent", "hooks", "smoke", "--json"]);
    expect(hooks.errors).toEqual([]);
    expect(hooks.command?.kind).toBe("agent");
    if (hooks.command?.kind === "agent") {
      expect(hooks.command.options.subcommand).toBe("hooks");
      expect(hooks.command.options.hookAction).toBe("smoke");
      expect(hooks.command.options.target).toBe("codex");
    }

    const hookStatus = parseCli(["agent", "hooks", "status", "--target", "claude", "--json"]);
    expect(hookStatus.errors).toEqual([]);
    expect(hookStatus.command?.kind).toBe("agent");
    if (hookStatus.command?.kind === "agent") {
      expect(hookStatus.command.options.subcommand).toBe("hooks");
      expect(hookStatus.command.options.hookAction).toBe("status");
      expect(hookStatus.command.options.target).toBe("claude");
    }

    const onboard = parseCli(["agent", "onboard", "--json"]);
    expect(onboard.errors).toEqual([]);
    expect(onboard.command?.kind).toBe("agent");
    if (onboard.command?.kind === "agent") {
      expect(onboard.command.options.subcommand).toBe("onboard");
      expect(onboard.command.options.target).toBe("codex");
    }

    const db = parseCli(["db", "doctor", "--json"]);
    expect(db.errors).toEqual([]);
    expect(db.command?.kind).toBe("db");
    if (db.command?.kind === "db") {
      expect(db.command.subcommand).toBe("doctor");
    }

    const doctorAgent = parseCli(["doctor", "agent", "--target", "cursor", "--json"]);
    expect(doctorAgent.errors).toEqual([]);
    expect(doctorAgent.command?.kind).toBe("doctor");
    if (doctorAgent.command?.kind === "doctor") {
      expect(doctorAgent.command.target).toBe("agent");
      expect(doctorAgent.command.agentTarget).toBe("cursor");
    }

    const ingestWatch = parseCli([
      "agent",
      "ingest",
      "codex",
      "--watch",
      "--file",
      ".forge/agent/events.ndjson",
      "--poll-interval",
      "500",
      "--json",
    ]);
    expect(ingestWatch.errors).toEqual([]);
    expect(ingestWatch.command?.kind).toBe("agent");
    if (ingestWatch.command?.kind === "agent") {
      expect(ingestWatch.command.options.subcommand).toBe("ingest");
      expect(ingestWatch.command.options.target).toBe("codex");
      expect(ingestWatch.command.options.watch).toBe(true);
      expect(ingestWatch.command.options.file).toBe(".forge/agent/events.ndjson");
      expect(ingestWatch.command.options.pollIntervalMs).toBe(500);
    }
  });

  test("hasUnknownOption flags unrecognized options", () => {
    expect(hasUnknownOption(["generate", "--nope"])).toBe("--nope");
    expect(hasUnknownOption(["generate", "--check"])).toBeNull();
    expect(hasUnknownOption(["add", "lucide-react", "--frontend"])).toBeNull();
    expect(hasUnknownOption(["add", "hono", "--backend"])).toBeNull();
  });

  test("parseCli accepts verify profile aliases", () => {
    const quick = parseCli(["verify", "quick", "--json"]);
    expect(quick.errors).toEqual([]);
    expect(quick.command?.kind).toBe("verify");
    if (quick.command?.kind === "verify") {
      expect(quick.command.options.fast).toBe(true);
    }

    const agent = parseCli(["verify", "agent", "--json"]);
    expect(agent.errors).toEqual([]);
    expect(agent.command?.kind).toBe("verify");
    if (agent.command?.kind === "verify") {
      expect(agent.command.options.standard).toBe(true);
    }

    const release = parseCli(["verify", "release", "--json"]);
    expect(release.errors).toEqual([]);
    expect(release.command?.kind).toBe("verify");
    if (release.command?.kind === "verify") {
      expect(release.command.options.strict).toBe(true);
      expect(release.command.options.internal).toBe(false);
    }

    const framework = parseCli(["verify", "framework", "--json"]);
    expect(framework.errors).toEqual([]);
    expect(framework.command?.kind).toBe("verify");
    if (framework.command?.kind === "verify") {
      expect(framework.command.options.strict).toBe(true);
      expect(framework.command.options.internal).toBe(true);
    }

    const unknown = parseCli(["verify", "banana", "--json"]);
    expect(unknown.errors).toContain(
      "unknown forge verify profile 'banana'; expected quick, smoke, agent, standard, release, strict, changed, framework, internal, or maintainer",
    );
  });

  test("main returns exit 1 for unrecognized command", async () => {
    const code = await main(["not-a-command"]);
    expect(code).toBe(1);
  });

  test("main prints focused help for empty command", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main([]);
      expect(code).toBe(0);
      expect(output).toContain("forge dev --once --json");
      expect(output).toContain("forge do \"fix\" --json");
      expect(output).toContain("forge doctor windows --json");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version"]);
      expect(code).toBe(0);
      expect(output.trim()).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("main prints JSON CLI version", async () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await main(["--version", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output) as { version?: string; cliVersion?: string };
      expect(parsed.version).toBe(parsed.cliVersion);
      expect(parsed.version).toMatch(/^\d+\.\d+\.\d+-alpha\.\d+$/);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("parseCli accepts verify with skip flags", () => {
    const parsed = parseCli([
      "verify",
      "--json",
      "--skip-tests",
      "--skip-eslint",
      "--smoke",
      "--script-timeout-ms",
      "1234",
    ]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("verify");
    if (parsed.command?.kind === "verify") {
      expect(parsed.command.options.skipTests).toBe(true);
      expect(parsed.command.options.skipEslint).toBe(true);
      expect(parsed.command.options.smoke).toBe(true);
      expect(parsed.command.options.scriptTimeoutMs).toBe(1234);
    }
  });

  test("parseCli accepts verify typechecker, test jobs, test plan, and compiler bench", () => {
    const verify = parseCli(["verify", "--typechecker", "native", "--test-jobs", "3", "--test-plan", "--json"]);
    expect(verify.errors).toEqual([]);
    expect(verify.command?.kind).toBe("verify");
    if (verify.command?.kind === "verify") {
      expect(verify.command.options.typechecker).toBe("native");
      expect(verify.command.options.testJobs).toBe(3);
      expect(verify.command.options.testPlan).toBe(true);
    }

    const ts7 = parseCli(["verify", "--typechecker", "ts7", "--json"]);
    expect(ts7.errors).toEqual([]);
    expect(ts7.command?.kind).toBe("verify");
    if (ts7.command?.kind === "verify") {
      expect(ts7.command.options.typechecker).toBe("ts7");
    }

    const bench = parseCli(["bench", "compiler", "--json", "--iterations", "2", "--warmups", "0", "--concurrency", "3"]);
    expect(bench.errors).toEqual([]);
    expect(bench.command?.kind).toBe("bench");
    if (bench.command?.kind === "bench") {
      expect(bench.command.options.iterations).toBe(2);
      expect(bench.command.options.warmups).toBe(0);
      expect(bench.command.options.concurrency).toBe(3);
    }
  });

  test("strict TestGraph jobs are bounded and configurable", () => {
    expect(chunkFiles(["a", "b", "c", "d", "e"], 2)).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    expect(resolveStrictTestJobs({ requested: 99, chunkCount: 3 })).toBe(3);
    expect(resolveStrictTestJobs({ requested: 1, chunkCount: 3 })).toBe(1);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictTestJobs({ env: { FORGE_VERIFY_TEST_JOBS: "not-a-number" }, chunkCount: 1 })).toBe(1);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 5 })).toBe(4);
    expect(resolveStrictIsolatedTestJobs({ env: { FORGE_VERIFY_ISOLATED_TEST_JOBS: "2" }, chunkCount: 5 })).toBe(2);
    expect(resolveStrictIsolatedTestJobs({ env: {}, chunkCount: 3 })).toBe(3);
  });

  test("strict TestGraph weighted chunks balance slow files", () => {
    const chunks = packWeightedStrictTestChunks(
      [
        { file: "slow-a.test.ts", estimatedMs: 10_000, durationSource: "profile" },
        { file: "slow-b.test.ts", estimatedMs: 9_000, durationSource: "profile" },
        { file: "fast-a.test.ts", estimatedMs: 500, durationSource: "fallback" },
        { file: "fast-b.test.ts", estimatedMs: 500, durationSource: "fallback" },
      ],
      2,
    );
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks[1]!.estimatedMs).toBeLessThanOrEqual(10_500);
    expect(chunks.some((chunk) => chunk.files.includes("slow-a.test.ts") && chunk.files.includes("slow-b.test.ts"))).toBe(false);
  });

  test("strict TestGraph plan is available without running tests", () => {
    const plan = buildStrictTestGraphPlan(process.cwd(), 3, {});
    expect(plan.fileCount).toBeGreaterThan(0);
    expect(plan.chunkCount).toBeGreaterThan(0);
    expect(plan.totalJobs).toBeLessThanOrEqual(3);
    expect(plan.laneMode).toBe("overlap");
    expect(plan.jobs + plan.isolatedJobs).toBeLessThanOrEqual(plan.totalJobs);
    expect(plan.jobs).toBeGreaterThan(0);
    expect(plan.isolatedJobs).toBeGreaterThan(0);
    expect(plan.lanes.serial.chunkCount).toBe(0);
    expect(plan.slowestFiles.length).toBeGreaterThan(0);

    const singleWorkerPlan = buildStrictTestGraphPlan(process.cwd(), 1, {});
    expect(singleWorkerPlan.totalJobs).toBe(1);
    expect(singleWorkerPlan.laneMode).toBe("sequential");
    expect(singleWorkerPlan.jobs).toBe(1);
    expect(singleWorkerPlan.isolatedJobs).toBe(1);
  }, 20_000);

  test("strict TestGraph lanes isolate global-heavy tests without serializing them", () => {
    expect(classifyStrictTestFile("tests/client/client-query.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/db/pglite-adapter.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/dev/server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-bridge.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-cli.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/external-manifest/external-runtime-node-cli.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/go-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/external-manifest/java-adapter-conformance.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-generation.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/cli/node-compat-dev-server.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/node-compat-new.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/cli/cli-verify-changed.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/impact/h28-impact-runner-diagnostics.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-artifacts.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release-self-host.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/release/h23-release.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-apply.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor-extract-action-bindings.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/refactor/h27-refactor.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/security/tenant-isolation/http-runtime.test.ts")).toBe("isolated");
    expect(classifyStrictTestFile("tests/templates/create-forge-app.test.ts")).toBe("parallel");
    expect(classifyStrictTestFile("tests/classifier/classify.test.ts")).toBe("parallel");
  });

  test("parseCli accepts impact test timeout", () => {
    const parsed = parseCli(["test", "run", "--changed", "--timeout-ms", "77", "--json"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("test");
    if (parsed.command?.kind === "test") {
      expect(parsed.command.options.timeoutMs).toBe(77);
    }
  });

  test("resolveBunExecutable ignores extensionless Windows PATH entries", () => {
    const kiroShim = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable ignores Kiro-Cli Windows bun executables", () => {
    const kiroExe = "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun || path === kiroExe,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => kiroExe,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable normalizes Windows bun shims with an exe sibling", () => {
    const bunShim = "C:\\Users\\David\\.bun\\bin\\bun";
    const realBun = "C:\\Users\\David\\.bun\\bin\\bun.exe";

    const resolved = resolveBunExecutable({
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => bunShim,
    });

    expect(resolved).toBe(realBun);
  });

  test("resolveBunExecutable refuses ambiguous Windows bun fallback", () => {
    expect(() => resolveBunExecutable({
      env: {},
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: () => false,
      homeDir: "C:\\Users\\David",
      platform: "win32",
      which: () => "C:\\Users\\David\\AppData\\Local\\Kiro-Cli\\bun.exe",
    })).toThrow("Unable to resolve a safe Bun executable on Windows");
  });

  test("resolveBunExecutable honors explicit FORGE_BUN", () => {
    const realBun = "D:\\Tools\\bun\\bun.exe";
    const resolved = resolveBunExecutable({
      env: { FORGE_BUN: realBun },
      execPath: "C:\\Program Files\\nodejs\\node.exe",
      exists: (path) => path === realBun,
      platform: "win32",
      which: () => null,
    });

    expect(resolved).toBe(realBun);
  });

  test("parseCli accepts dev with port and watch flags", () => {
    const parsed = parseCli(["dev", "--port", "4000", "--watch", "--mock", "--db", "memory", "--skip-startup-console"]);
    expect(parsed.errors).toEqual([]);
    expect(parsed.command?.kind).toBe("dev");
    if (parsed.command?.kind === "dev") {
      expect(parsed.command.port).toBe(4000);
      expect(parsed.command.watch).toBe(true);
      expect(parsed.command.mock).toBe(true);
      expect(parsed.command.db).toBe("memory");
      expect(parsed.command.skipStartupConsole).toBe(true);
    }
  });

});
