import { spawn, spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { basename, join, relative, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { normalizePath } from "../compiler/primitives/paths.ts";
import { nodeFileSystem } from "../compiler/fs/index.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";
import { createDiagnostic } from "../compiler/diagnostics/create.ts";
import { run as runGenerate } from "../compiler/orchestrator/run.ts";
import { runAgentPrepare } from "../agent-adapters/index.ts";
import { runAgentHooksStatus } from "../agent-adapters/index.ts";
import type { AgentAdapterTarget } from "../agent-adapters/types.ts";
import type { DevConsoleCycle, DevConsoleDiffPlan, DevConsoleGeneratedSummary } from "../dev-console/types.ts";
import { runDevConsoleCycle } from "../dev-console/cycle.ts";
import { runChangedCommand } from "./changed.ts";
import { runDeltaStatus } from "../delta/index.ts";
import {
  codexAppServerCommands,
  generateCodexAppServerSchemas,
  inspectCodexAppServer,
  probeCodexAppServerHandshake,
  skippedCodexAppServerHandshake,
  type CodexAppServerCommands,
  type CodexAppServerHandshakeResult,
  type CodexAppServerProof,
  type CodexAppServerSchemaGenerationResult,
} from "./codex-app-server.ts";

const STUDIO_TARGET_RUNTIME_PORT = 3766;
const STUDIO_LOCAL_TENANT_ID = "00000000-0000-4000-8000-000000000001";
const STUDIO_LOCAL_USER_ID = "forge-studio-dev";
const STUDIO_LOCAL_ROLE = "owner";

export interface StudioAttachOptions {
  workspaceRoot: string;
  subcommand?: "attach" | "snapshot" | "watch" | "open" | "doctor" | "bridge" | "codex-server";
  path?: string;
  previewUrl?: string;
  previewPort?: number;
  studioUrl?: string;
  intervalMs?: number;
  once?: boolean;
  workspaceId?: string;
  tenantId?: string;
  userId?: string;
  role?: string;
  targets: string[];
  install?: boolean;
  start?: boolean;
  bridge?: boolean;
  writeSchemas?: boolean;
  probeAppServer?: boolean;
  json: boolean;
  dryRun: boolean;
  force: boolean;
}

export interface StudioAttachResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "attach";
  app: {
    name: string;
    path: string;
    template?: string;
  };
  preview: {
    url: string;
    port?: number;
    requestedUrl?: string;
    requestedPort?: number;
    source: "explicit-url" | "preview-port" | "default" | "studio-avoid-self-preview";
    isStudioSelfPreview: boolean;
    note: string;
    status: {
      state: "reachable" | "not-running" | "not-checked";
      checked: boolean;
      reason: string;
      suggestedCommands: string[];
    };
  };
  posture: {
    checked: boolean;
    state: "ready" | "needs-attention" | "not-checked";
    reason: string;
    safeToEdit?: boolean;
    generated?: DevConsoleGeneratedSummary;
    changedFiles?: number;
    diffPlan?: DevConsoleDiffPlan;
    recommendedCommands: string[];
  };
  targets: string[];
  manifestPath: string;
  filesWritten: string[];
  filesPlanned: string[];
  agentResults: Array<{
    target: string;
    ok: boolean;
    filesWritten: string[];
    filesPlanned: string[];
    diagnostics: Diagnostic[];
  }>;
  commands: {
    startTargetApp: string;
    startTargetAppCwd: string;
    openPreview: string;
    probePreview: string;
    installHooks: string[];
    checkHooks: string[];
    openContext: string;
    codexAppServer?: CodexAppServerCommands;
  };
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface StudioSnapshotResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "snapshot";
  app: StudioAttachResult["app"];
  preview: StudioAttachResult["preview"];
  posture: StudioAttachResult["posture"];
  targets: string[];
  changed: Record<string, unknown>;
  commands: StudioAttachResult["commands"] & {
    attach: string;
    changed: string;
    handoff: string;
    watch: string;
    bridge: string;
    doctor: string;
    open: string;
  };
  contextPacket: {
    source: "forgeos";
    readFiles: string[];
    commands: string[];
    diffPlan?: DevConsoleDiffPlan;
  };
  proofs: {
    preview: StudioAttachResult["preview"]["status"];
    generated: StudioAttachResult["posture"]["generated"];
    hooks: Array<{
      target: string;
      ok: boolean;
      installed?: boolean;
      bridgeWritable?: boolean;
      deltaWritable?: boolean;
      visibleInMemory?: boolean;
      recentEvents?: number;
      usefulSignals?: number;
      nativeSignals?: number;
      canarySignals?: number;
      approvalRequired?: boolean;
      approvalStatus?: string;
      workspaceRoot?: string;
      ignoredOutOfWorkspaceEvents?: number;
      lastSignal?: unknown;
      checks?: unknown[];
      diagnostics?: Diagnostic[];
      nextActions?: string[];
    }>;
    codexAppServer?: CodexAppServerProof;
    delta?: unknown;
  };
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface StudioWatchResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "watch";
  stream: {
    mode: "once" | "watch";
    event: "studio.snapshot";
    note: string;
    followCommand: string;
    intervalMs: number;
    dryRun: boolean;
    emittedAt: string;
  };
  snapshot: StudioSnapshotResult;
  exitCode: 0 | 1;
}

export interface StudioDoctorResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "doctor";
  app: StudioAttachResult["app"];
  checks: Array<{
    name: string;
    ok: boolean;
    status: "ok" | "warning" | "failed";
    message: string;
    suggestedCommands: string[];
  }>;
  snapshot: StudioSnapshotResult;
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface StudioBridgeResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "bridge";
  mode: "once" | "watch";
  studioUrl: string;
  endpoint: string;
  intervalMs: number;
  provider: string;
  target: string;
  posted: boolean;
  dryRun: boolean;
  snapshot: StudioSnapshotResult;
  response?: unknown;
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface StudioOpenResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "open";
  app: StudioAttachResult["app"];
  preview: StudioAttachResult["preview"];
  attach: StudioAttachResult;
  previewAutomation: {
    attempted: boolean;
    started: boolean;
    alreadyRunning?: boolean;
    skippedReason?: "already-running" | "dry-run" | "disabled" | "non-local-preview" | "missing-dependencies" | "install-failed";
    command: string;
    cwd: string;
    pid?: number;
    owner?: {
      kind: "forge-managed" | "external-process" | "preexisting-reachable-preview" | "not-owned" | "dry-run";
      pid?: number;
      command?: string;
      evidence: string;
      statePath?: string;
    };
    statusBefore: StudioAttachResult["preview"]["status"];
    statusAfter: StudioAttachResult["preview"]["status"];
    install: {
      required: boolean;
      installed: boolean;
      attempted: boolean;
      command?: string;
      cwd: string;
      ok?: boolean;
      exitCode?: number;
    };
  };
  bridge: {
    attempted: boolean;
    ok: boolean;
    posted: boolean;
    dryRun: boolean;
    mode?: "once" | "watch";
    autoStarted?: boolean;
    alreadyRunning?: boolean;
    command?: string;
    cwd?: string;
    intervalMs?: number;
    pid?: number;
    studioUrl: string;
    endpoint?: string;
    diagnostics: Diagnostic[];
    nextActions: string[];
  };
  commands: StudioAttachResult["commands"] & {
    attach: string;
    bridge: string;
    doctor: string;
    open: string;
    install?: string;
  };
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

export interface StudioCodexServerResult {
  schemaVersion: "0.1.0";
  ok: boolean;
  action: "codex-server";
  app: StudioAttachResult["app"];
  proof: CodexAppServerProof;
  schemaGeneration: CodexAppServerSchemaGenerationResult;
  handshake: CodexAppServerHandshakeResult;
  commands: CodexAppServerCommands;
  diagnostics: Diagnostic[];
  nextActions: string[];
  exitCode: 0 | 1;
}

function readPackageJson(appRoot: string): Record<string, unknown> {
  const path = join(appRoot, "package.json");
  if (!nodeFileSystem.exists(path)) {
    return {};
  }
  try {
    return JSON.parse(nodeFileSystem.readText(path) ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function packageName(pkg: Record<string, unknown>, appRoot: string): string {
  return typeof pkg.name === "string" && pkg.name.trim()
    ? pkg.name.trim()
    : basename(appRoot);
}

function packageTemplate(pkg: Record<string, unknown>): string | undefined {
  const forge = pkg.forge;
  if (!forge || typeof forge !== "object" || Array.isArray(forge)) {
    return undefined;
  }
  const template = (forge as { template?: unknown }).template;
  return typeof template === "string" ? template : undefined;
}

function normalizeTarget(target: string): string {
  return target === "claude-code" ? "claude" : target;
}

function expandedTargets(targets: string[]): string[] {
  const normalized = targets.map(normalizeTarget);
  return normalized.includes("all")
    ? ["codex", "claude", "cursor"]
    : [...new Set(normalized)];
}

function providerName(target: string): string {
  const normalized = normalizeTarget(target);
  if (normalized === "claude") return "Claude Code";
  if (normalized === "cursor") return "Cursor";
  return "Codex";
}

function hasCodexTarget(targets: string[]): boolean {
  return targets.map(normalizeTarget).includes("codex");
}

function normalizeStudioUrl(value?: string): string {
  return (value?.trim() || process.env.FORGE_STUDIO_URL || "http://127.0.0.1:3765").replace(/\/+$/, "");
}

function localPreviewPort(url: string): number | undefined {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname !== "localhost" && hostname !== "127.0.0.1") {
      return undefined;
    }
    const port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
}

function previewStatus(
  state: StudioAttachResult["preview"]["status"]["state"],
  reason: string,
  suggestedCommands: string[] = [],
): StudioAttachResult["preview"]["status"] {
  return {
    state,
    checked: state !== "not-checked",
    reason,
    suggestedCommands,
  };
}

function withPreviewStatus(
  preview: Omit<StudioAttachResult["preview"], "status">,
  status: StudioAttachResult["preview"]["status"] = previewStatus("not-checked", "preview reachability has not been checked yet"),
): StudioAttachResult["preview"] {
  return { ...preview, status };
}

function previewFor(options: StudioAttachOptions, diagnostics: Diagnostic[]): StudioAttachResult["preview"] {
  const avoidSelfPreview = (requestedUrl: string, requestedPort: number): StudioAttachResult["preview"] => {
    if (requestedPort !== 5173 || options.force) {
      return withPreviewStatus({
        url: requestedUrl,
        port: requestedPort,
        source: options.previewUrl?.trim() ? "explicit-url" : "preview-port",
        isStudioSelfPreview: requestedPort === 5173,
        note: requestedPort === 5173
          ? "Preview points at the conventional Forge Studio port because --force was used."
          : "Preview URL was provided explicitly.",
      });
    }
    diagnostics.push(createDiagnostic({
      severity: "warning",
      code: "FORGE_STUDIO_SELF_PREVIEW_AVOIDED",
      message: "preview pointed at http://127.0.0.1:5173, which is normally Forge Studio itself; using http://127.0.0.1:5174 for the target app preview",
      fixHint: "Start the app under construction on 5174, or pass --force if 5173 is intentionally the target app.",
      suggestedCommands: ["forge studio attach . --preview-port 5174 --target codex --json", targetAppDevCommand(5174)],
    }));
    return withPreviewStatus({
      url: "http://127.0.0.1:5174",
      port: 5174,
      requestedUrl,
      requestedPort,
      source: "studio-avoid-self-preview",
      isStudioSelfPreview: true,
      note: "Avoided rendering Forge Studio inside itself; use 5174 for the app being built.",
    });
  };

  if (options.previewUrl?.trim()) {
    const requestedUrl = options.previewUrl.trim();
    const requestedPort = localPreviewPort(requestedUrl);
    if (requestedPort) {
      return avoidSelfPreview(requestedUrl, requestedPort);
    }
    return withPreviewStatus({
      url: requestedUrl,
      source: "explicit-url",
      isStudioSelfPreview: false,
      note: "Preview URL was provided explicitly.",
    });
  }
  if (options.previewPort) {
    const requestedUrl = `http://127.0.0.1:${options.previewPort}`;
    if (options.previewPort === 5173) {
      return avoidSelfPreview(requestedUrl, options.previewPort);
    }
    return withPreviewStatus({
      url: requestedUrl,
      port: options.previewPort,
      source: "preview-port",
      isStudioSelfPreview: false,
      note: "Preview port was provided explicitly.",
    });
  }
  return withPreviewStatus({
    url: "http://127.0.0.1:5174",
    port: 5174,
    source: "default",
    isStudioSelfPreview: false,
    note: "Default target app preview URL for Studio observer flows.",
  });
}

function localPreviewHost(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return "127.0.0.1";
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function probeStudioPreview(
  preview: Omit<StudioAttachResult["preview"], "status">,
  options: { dryRun: boolean; startCommand: string; timeoutMs?: number },
): Promise<StudioAttachResult["preview"]["status"]> {
  if (options.dryRun) {
    return previewStatus("not-checked", "dry-run does not probe the preview URL", [options.startCommand]);
  }
  const host = localPreviewHost(preview.url);
  const port = preview.port ?? localPreviewPort(preview.url);
  if (!host || !port) {
    return previewStatus("not-checked", "preview URL is not a local host:port pair", [options.startCommand]);
  }
  const timeoutMs = options.timeoutMs ?? 500;
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => settle(false));
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
  return reachable
    ? previewStatus("reachable", `preview is reachable at ${preview.url}`, [])
    : previewStatus("not-running", `preview is not reachable at ${preview.url}`, [options.startCommand, "forge dev --once --json"]);
}

function renderManifest(input: {
  app: StudioAttachResult["app"];
  preview: StudioAttachResult["preview"];
  posture: StudioAttachResult["posture"];
  targets: string[];
  commands: StudioAttachResult["commands"];
}): string {
  return `${JSON.stringify({
    schemaVersion: "0.1.0",
    attachedAt: new Date().toISOString(),
    app: input.app,
    preview: input.preview,
    posture: input.posture,
    targets: input.targets,
    commands: input.commands,
  }, null, 2)}\n`;
}

function readAttachmentManifest(appRoot: string): Partial<StudioAttachResult> | null {
  const absolute = join(appRoot, ".forge", "studio", "attachment.json");
  if (!nodeFileSystem.exists(absolute)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(absolute) ?? "{}") as Partial<StudioAttachResult>;
  } catch {
    return null;
  }
}

function attachCommandFor(targets: string[], previewPort: number): string {
  const targetArgs = (targets.length > 0 ? targets : ["codex"])
    .map((target) => `--target ${target}`)
    .join(" ");
  return `forge studio attach . --preview-port ${previewPort} ${targetArgs} --json`;
}

function targetAppDevCommand(previewPort: number): string {
  return `forge dev --port ${STUDIO_TARGET_RUNTIME_PORT} --web-port ${previewPort}`;
}

function forgeSourcePresent(appRoot: string): boolean {
  return nodeFileSystem.exists(join(appRoot, "src", "forge"));
}

async function withWorkspaceCwd<T>(workspaceRoot: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.cwd();
  const target = resolve(workspaceRoot);
  if (resolve(previous).toLowerCase() === target.toLowerCase()) {
    return fn();
  }
  process.chdir(target);
  try {
    return await fn();
  } finally {
    process.chdir(previous);
  }
}

function postureFromDevCycle(cycle: DevConsoleCycle): StudioAttachResult["posture"] {
  return {
    checked: true,
    state: cycle.ok ? "ready" : "needs-attention",
    reason: cycle.ok
      ? "forge dev --once completed cleanly for the attached app"
      : "forge dev --once found issues in the attached app",
    safeToEdit: cycle.summary.agentContext.safeToEdit,
    generated: cycle.summary.generated,
    changedFiles: cycle.summary.agentContext.changedFiles,
    ...(cycle.summary.agentContext.diffPlan ? { diffPlan: cycle.summary.agentContext.diffPlan } : {}),
    recommendedCommands: cycle.summary.agentContext.recommendedCommands.length > 0
      ? cycle.summary.agentContext.recommendedCommands
      : ["forge dev --once --json"],
  };
}

async function inspectAttachPosture(
  appRoot: string,
  options: StudioAttachOptions,
): Promise<StudioAttachResult["posture"]> {
  if (options.dryRun) {
    return {
      checked: false,
      state: "not-checked",
      reason: "dry-run does not run forge dev --once in the attached app",
      recommendedCommands: ["forge dev --once --json"],
    };
  }
  if (!forgeSourcePresent(appRoot)) {
    return {
      checked: false,
      state: "not-checked",
      reason: "attached path does not contain src/forge; no ForgeOS posture snapshot was collected",
      recommendedCommands: ["forge dev --once --json", "forge status --json"],
    };
  }
  try {
    return postureFromDevCycle(await runDevConsoleCycle({
      workspaceRoot: appRoot,
      mode: "once",
      includeImpact: true,
    }));
  } catch (error) {
    return {
      checked: false,
      state: "not-checked",
      reason: `forge dev --once snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      recommendedCommands: ["forge dev --once --json", "forge check --json"],
    };
  }
}

async function inspectReadOnlyPosture(
  appRoot: string,
): Promise<StudioAttachResult["posture"]> {
  if (!forgeSourcePresent(appRoot)) {
    return {
      checked: false,
      state: "not-checked",
      reason: "attached path does not contain src/forge; no ForgeOS posture snapshot was collected",
      recommendedCommands: ["forge dev --once --json", "forge status --json"],
    };
  }
  try {
    const generated = await withWorkspaceCwd(appRoot, () =>
      runGenerate({
        workspaceRoot: appRoot,
        check: true,
        dryRun: false,
        json: false,
        concurrency: 4,
      })
    );
    const changed = runChangedCommand(appRoot);
    const summary = changed.data.summary as { changedFiles?: number } | undefined;
    const diffPlan = changed.data.diffPlan as DevConsoleDiffPlan | undefined;
    const generatedSummary: DevConsoleGeneratedSummary = {
      ok: generated.exitCode === 0,
      state: generated.exitCode === 0 ? "fresh" : "stale-risk",
      changedFiles: generated.changed.length,
      sampleChanged: generated.changed.slice(0, 12),
      hiddenChanged: Math.max(0, generated.changed.length - 12),
      message: generated.exitCode === 0
        ? "generated artifacts are fresh; snapshot did not write files"
        : "generated artifacts may be stale; snapshot did not regenerate files",
      command: "forge generate",
      checkCommand: "forge generate --check --json",
    };
    return {
      checked: true,
      state: generated.exitCode === 0 ? "ready" : "needs-attention",
      reason: generated.exitCode === 0
        ? "read-only generated check passed"
        : "read-only generated check found stale generated artifacts",
      safeToEdit: generated.exitCode === 0,
      generated: generatedSummary,
      changedFiles: summary?.changedFiles ?? 0,
      ...(diffPlan ? { diffPlan } : {}),
      recommendedCommands: generated.exitCode === 0
        ? ["forge dev --once --json", "forge changed --json"]
        : ["forge generate", "forge check --json"],
    };
  } catch (error) {
    return {
      checked: false,
      state: "not-checked",
      reason: `read-only generated snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      recommendedCommands: ["forge generate --check --json", "forge check --json"],
    };
  }
}

async function collectHookProofs(appRoot: string, targets: string[]): Promise<StudioSnapshotResult["proofs"]["hooks"]> {
  const proofs: StudioSnapshotResult["proofs"]["hooks"] = [];
  for (const target of targets) {
    try {
      const result = await runAgentHooksStatus({
        subcommand: "hooks",
        hookAction: "status",
        workspaceRoot: appRoot,
        json: true,
        target: target as AgentAdapterTarget,
        dryRun: false,
        force: false,
        preserveUserSections: true,
        skills: true,
        rules: true,
      });
      proofs.push({
        target,
        ok: result.ok,
        installed: result.installed,
        bridgeWritable: result.bridgeWritable,
        deltaWritable: result.deltaWritable,
        visibleInMemory: result.visibleInMemory,
        recentEvents: result.recentEvents,
        usefulSignals: result.usefulSignals,
        nativeSignals: result.nativeSignals,
        canarySignals: result.canarySignals,
        approvalRequired: result.approvalRequired,
        approvalStatus: result.approvalStatus,
        workspaceRoot: result.workspaceRoot,
        ignoredOutOfWorkspaceEvents: result.ignoredOutOfWorkspaceEvents,
        ...(result.lastSignal ? { lastSignal: result.lastSignal } : {}),
        checks: result.checks,
        diagnostics: result.diagnostics,
        nextActions: result.nextActions,
      });
    } catch (error) {
      proofs.push({
        target,
        ok: false,
        nextActions: [`forge agent hooks status --target ${target} --json`],
        lastSignal: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
  return proofs;
}

function contextPacketFor(input: {
  appRoot: string;
  posture: StudioAttachResult["posture"];
  commands: StudioSnapshotResult["commands"];
}): StudioSnapshotResult["contextPacket"] {
  return {
    source: "forgeos",
    readFiles: [
      "AGENTS.md",
      "src/forge/_generated/agentContract.json",
      "src/forge/_generated/appMap.md",
      "src/forge/_generated/runtimeRules.md",
      "src/forge/_generated/operationPlaybooks.md",
      "src/forge/_generated/frontendGraph.json",
    ].filter((file) => nodeFileSystem.exists(join(input.appRoot, file))),
    commands: [
      input.commands.changed,
      input.commands.handoff,
      input.commands.probePreview,
      input.commands.doctor,
      ...(input.commands.codexAppServer
        ? [
            input.commands.codexAppServer.inspect,
            input.commands.codexAppServer.generateTypes,
            input.commands.codexAppServer.generateJsonSchema,
            input.commands.codexAppServer.probeHandshake,
          ]
        : []),
      ...input.commands.checkHooks,
    ],
    ...(input.posture.diffPlan ? { diffPlan: input.posture.diffPlan } : {}),
  };
}

function mergeCodexAppServerHandshakeProof(
  proof: CodexAppServerProof,
  handshake: CodexAppServerHandshakeResult | undefined,
): CodexAppServerProof {
  if (!handshake) {
    return proof;
  }
  const handshakeReady = handshake.ok && handshake.initialized;
  const checks = handshakeReady && !proof.available
    ? proof.checks.map((check) => {
        if (check.name === "codex-cli") {
          return {
            ...check,
            ok: true,
            status: "ok" as const,
            message: "Codex app-server initialized over stdio; CLI version probe is no longer blocking.",
          };
        }
        if (check.name === "codex-app-server") {
          return {
            ...check,
            ok: true,
            status: "ok" as const,
            message: "Codex app-server handshake succeeded over stdio.",
          };
        }
        if (check.name === "codex-app-server-schemas") {
          return {
            ...check,
            ok: true,
            status: "ok" as const,
            message: "Codex app-server is available; generate version-matched schemas when implementing the streaming client.",
          };
        }
        return check;
      })
    : proof.checks;
  const nextActions = Array.from(new Set(handshakeReady
    ? handshake.nextActions
    : [...(proof.nextActions ?? []), ...handshake.nextActions]));
  return {
    ...proof,
    ...(handshakeReady ? { state: "ready" as const, available: true, error: undefined } : {}),
    handshake,
    checks,
    nextActions,
  };
}

export async function runStudioAttachCommand(options: StudioAttachOptions): Promise<StudioAttachResult> {
  const appRoot = resolve(options.workspaceRoot, options.path ?? ".").replace(/\\/g, "/");
  const pkg = readPackageJson(appRoot);
  const diagnostics: Diagnostic[] = [];
  if (!nodeFileSystem.exists(join(appRoot, "package.json"))) {
    diagnostics.push(createDiagnostic({
      severity: "warning",
      code: "FORGE_STUDIO_PACKAGE_JSON_MISSING",
      message: `no package.json found in ${appRoot}; attaching as a filesystem workspace`,
      file: "package.json",
    }));
  }

  const targets = expandedTargets(options.targets);
  const initialPreview = previewFor(options, diagnostics);
  const app = {
    name: packageName(pkg, appRoot),
    path: appRoot,
    ...(packageTemplate(pkg) ? { template: packageTemplate(pkg) } : {}),
  };
  const commands = {
    startTargetApp: targetAppDevCommand(initialPreview.port ?? 5174),
    startTargetAppCwd: appRoot,
    openPreview: initialPreview.url,
    probePreview: "forge dev --once --json",
    installHooks: targets.map((target) => `forge agent onboard --target ${target} --json`),
    checkHooks: targets.map((target) => `forge agent hooks status --target ${target} --json`),
    openContext: "forge agent context --current --json",
    ...(hasCodexTarget(targets) ? { codexAppServer: codexAppServerCommands() } : {}),
  };
  const preview = {
    ...initialPreview,
    status: await probeStudioPreview(initialPreview, {
      dryRun: options.dryRun,
      startCommand: commands.startTargetApp,
    }),
  };
  const posture = await inspectAttachPosture(appRoot, options);
  const manifestPath = ".forge/studio/attachment.json";
  const filesPlanned = [manifestPath];
  const filesWritten: string[] = [];

  if (!options.dryRun) {
    const absoluteManifest = join(appRoot, manifestPath);
    nodeFileSystem.mkdirp(join(appRoot, ".forge", "studio"));
    nodeFileSystem.writeText(absoluteManifest, renderManifest({ app, preview, posture, targets, commands }));
    filesWritten.push(manifestPath);
  }

  const agentResults = [];
  if (!options.dryRun) {
    for (const target of targets) {
      const result = await runAgentPrepare({
        subcommand: "prepare",
        workspaceRoot: appRoot,
        json: options.json,
        target: target as AgentAdapterTarget,
        dryRun: false,
        force: options.force,
        preserveUserSections: true,
        skills: true,
        rules: true,
      });
      diagnostics.push(...result.diagnostics);
      agentResults.push({
        target,
        ok: result.ok,
        filesWritten: result.exportResult.filesWritten,
        filesPlanned: result.exportResult.filesPlanned,
        diagnostics: result.diagnostics,
      });
    }
  }

  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error") &&
    agentResults.every((result) => result.ok);
  const nextActions = ok
    ? [
        commands.startTargetApp,
        commands.probePreview,
        ...commands.checkHooks,
      ]
    : [
        "forge generate",
        "forge agent doctor --target codex --json",
        "forge dev --once --json",
      ];

  return {
    schemaVersion: "0.1.0",
    ok,
    action: "attach",
    app,
    preview,
    posture,
    targets,
    manifestPath,
    filesWritten,
    filesPlanned,
    agentResults,
    commands,
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export async function runStudioSnapshotCommand(options: StudioAttachOptions): Promise<StudioSnapshotResult> {
  const appRoot = resolve(options.workspaceRoot, options.path ?? ".").replace(/\\/g, "/");
  const manifest = readAttachmentManifest(appRoot);
  const pkg = readPackageJson(appRoot);
  const diagnostics: Diagnostic[] = [];
  const manifestPreview = manifest?.preview;
  const manifestTargets = Array.isArray(manifest?.targets)
    ? manifest.targets.filter((target): target is string => typeof target === "string")
    : [];
  const targets = options.targets.length === 1 && options.targets[0] === "codex" && manifestTargets.length > 0
    ? expandedTargets(manifestTargets)
    : expandedTargets(options.targets);
  const effectiveOptions: StudioAttachOptions = {
    ...options,
    targets,
    previewUrl: options.previewUrl ?? (!options.previewPort && manifestPreview?.url ? manifestPreview.url : undefined),
    previewPort: options.previewPort ?? (!options.previewUrl && manifestPreview?.port ? manifestPreview.port : undefined),
  };
  const initialPreview = previewFor(effectiveOptions, diagnostics);
  const app = {
    name: packageName(pkg, appRoot),
    path: appRoot,
    ...(packageTemplate(pkg) ? { template: packageTemplate(pkg) } : {}),
  };
  const baseCommands = {
    startTargetApp: targetAppDevCommand(initialPreview.port ?? 5174),
    startTargetAppCwd: appRoot,
    openPreview: initialPreview.url,
    probePreview: "forge dev --once --json",
    installHooks: targets.map((target) => `forge agent onboard --target ${target} --json`),
    checkHooks: targets.map((target) => `forge agent hooks status --target ${target} --json`),
    openContext: "forge agent context --current --json",
    ...(hasCodexTarget(targets) ? { codexAppServer: codexAppServerCommands() } : {}),
  };
  const preview = {
    ...initialPreview,
    status: await probeStudioPreview(initialPreview, {
      dryRun: effectiveOptions.dryRun,
      startCommand: baseCommands.startTargetApp,
    }),
  };
  const posture = await inspectReadOnlyPosture(appRoot);
  const changed = runChangedCommand(appRoot);
  const attachPreviewPort = preview.port ?? localPreviewPort(preview.url) ?? 5174;
  const commands = {
    ...baseCommands,
    attach: attachCommandFor(targets, attachPreviewPort),
    changed: "forge changed --json",
    handoff: "forge handoff --json",
    watch: `forge studio watch . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
    bridge: `forge studio bridge . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")} --studio-url http://127.0.0.1:3765${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
    doctor: `forge studio doctor . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
    open: `forge studio open . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
  };
  const hookProofs = await collectHookProofs(appRoot, targets);
  const codexAppServerBase = hasCodexTarget(targets)
    ? inspectCodexAppServer({ workspaceRoot: appRoot, relevant: true })
    : undefined;
  const codexAppServerHandshake = codexAppServerBase && options.probeAppServer
      ? await probeCodexAppServerHandshake({
        workspaceRoot: appRoot,
        dryRun: options.dryRun,
        available: codexAppServerBase.available ? true : undefined,
        disabled: codexAppServerBase.state === "disabled",
      })
    : undefined;
  const codexAppServer = codexAppServerBase
    ? mergeCodexAppServerHandshakeProof(codexAppServerBase, codexAppServerHandshake)
    : undefined;
  const delta = await runDeltaStatus(appRoot);
  const contextPacket = contextPacketFor({ appRoot, posture, commands });
  const gitState = (changed.data as { git?: { available?: boolean } }).git;
  const changedReadable = changed.ok || gitState?.available === false;
  const ok = posture.state !== "needs-attention" && changedReadable &&
    diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  const nextActions = [
    commands.startTargetApp,
    commands.probePreview,
    commands.changed,
    commands.doctor,
    ...(codexAppServer && !codexAppServer.handshake && commands.codexAppServer?.probeHandshake
      ? [commands.codexAppServer.probeHandshake]
      : []),
    ...commands.checkHooks,
  ];
  return {
    schemaVersion: "0.1.0",
    ok,
    action: "snapshot",
    app,
    preview,
    posture,
    targets,
    changed: changed.data,
    commands,
    contextPacket,
    proofs: {
      preview: preview.status,
      generated: posture.generated,
      hooks: hookProofs,
      ...(codexAppServer ? { codexAppServer } : {}),
      delta,
    },
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export async function runStudioWatchCommand(options: StudioAttachOptions): Promise<StudioWatchResult> {
  const snapshot = await runStudioSnapshotCommand(options);
  const intervalMs = Math.max(1000, Math.floor(options.intervalMs ?? 5000));
  const single = options.once || options.dryRun;
  return {
    schemaVersion: "0.1.0",
    ok: snapshot.ok,
    action: "watch",
    stream: {
      mode: single ? "once" : "watch",
      event: "studio.snapshot",
      note: single
        ? "This command emitted one Studio-compatible snapshot event."
        : "This command emits Studio-compatible snapshot events until stopped.",
      followCommand: "forge dev --watch --json",
      intervalMs,
      dryRun: options.dryRun,
      emittedAt: new Date().toISOString(),
    },
    snapshot,
    exitCode: snapshot.exitCode,
  };
}

export async function runStudioWatchLoop(
  options: StudioAttachOptions,
  onResult: (result: StudioWatchResult) => void,
): Promise<0 | 1> {
  do {
    const result = await runStudioWatchCommand(options);
    onResult(result);
    if (options.once || options.dryRun) {
      return result.exitCode;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.floor(options.intervalMs ?? 5000))));
  } while (true);
}

async function postStudioSnapshot(input: {
  studioUrl: string;
  workspaceId?: string;
  provider: string;
  snapshot: StudioSnapshotResult;
  bridge: {
    mode: "once" | "watch";
    intervalMs: number;
    postedAt: string;
  };
  tenantId?: string;
  userId?: string;
  role?: string;
}): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  const endpoint = `${input.studioUrl}/commands/ingestStudioSnapshot`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forge-tenant-id": input.tenantId ?? process.env.FORGE_TENANT_ID ?? STUDIO_LOCAL_TENANT_ID,
        "x-forge-user-id": input.userId ?? process.env.FORGE_USER_ID ?? STUDIO_LOCAL_USER_ID,
        "x-forge-role": input.role ?? process.env.FORGE_ROLE ?? STUDIO_LOCAL_ROLE,
      },
      body: JSON.stringify({
        args: {
          ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
          provider: input.provider,
          snapshot: input.snapshot,
          bridge: {
            ...input.bridge,
            status: "received",
          },
        },
      }),
    });
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok && (body as { ok?: boolean }).ok !== false,
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function runStudioBridgeCommand(options: StudioAttachOptions): Promise<StudioBridgeResult> {
  const targets = expandedTargets(options.targets.length > 0 ? options.targets : ["codex"]);
  const target = targets[0] ?? "codex";
  const provider = providerName(target);
  const studioUrl = normalizeStudioUrl(options.studioUrl);
  const endpoint = `${studioUrl}/commands/ingestStudioSnapshot`;
  const intervalMs = Math.max(1000, Math.floor(options.intervalMs ?? 5000));
  const diagnostics: Diagnostic[] = [];
  const snapshot = await runStudioSnapshotCommand({
    ...options,
    targets,
    dryRun: options.dryRun,
  });

  let posted = false;
  let responseBody: unknown;
  if (options.dryRun) {
    diagnostics.push(createDiagnostic({
      severity: "info",
      code: "FORGE_STUDIO_BRIDGE_DRY_RUN",
      message: `dry-run collected a Studio snapshot but did not POST it to ${endpoint}`,
      suggestedCommands: [`forge studio bridge . --studio-url ${studioUrl} --target ${target} --preview-port ${snapshot.preview.port ?? 5174} --json`],
    }));
  } else {
    const response = await postStudioSnapshot({
      studioUrl,
      workspaceId: options.workspaceId,
      provider,
      snapshot,
      bridge: {
        mode: options.once || options.dryRun ? "once" : "watch",
        intervalMs,
        postedAt: new Date().toISOString(),
      },
      tenantId: options.tenantId,
      userId: options.userId,
      role: options.role,
    });
    posted = response.ok;
    responseBody = response.body;
    if (!response.ok) {
      diagnostics.push(createDiagnostic({
        severity: "error",
        code: response.status === 0 ? "FORGE_STUDIO_BRIDGE_UNREACHABLE" : "FORGE_STUDIO_BRIDGE_INGEST_FAILED",
        message: response.status === 0
          ? `cannot reach Forge Studio runtime at ${studioUrl}: ${response.error ?? "network request failed"}`
          : `Forge Studio rejected snapshot ingest with HTTP ${response.status}`,
        fixHint: `Start Forge Studio, then run forge studio bridge . --studio-url ${studioUrl} --target ${target} --preview-port ${snapshot.preview.port ?? 5174} --json`,
        suggestedCommands: [
          "npm run dev",
          `forge studio doctor . --preview-port ${snapshot.preview.port ?? 5174} --target ${target} --json`,
        ],
      }));
    }
  }

  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  const nextActions = ok
    ? [
        `forge studio bridge . --studio-url ${studioUrl} --target ${target} --preview-port ${snapshot.preview.port ?? 5174} --json`,
        snapshot.commands.doctor,
        snapshot.commands.changed,
      ]
    : [
        "Start Forge Studio with npm run dev",
        `forge studio bridge . --studio-url ${studioUrl} --target ${target} --preview-port ${snapshot.preview.port ?? 5174} --json`,
        snapshot.commands.doctor,
      ];

  return {
    schemaVersion: "0.1.0",
    ok,
    action: "bridge",
    mode: options.once || options.dryRun ? "once" : "watch",
    studioUrl,
    endpoint,
    intervalMs,
    provider,
    target,
    posted,
    dryRun: options.dryRun,
    snapshot,
    ...(responseBody !== undefined ? { response: responseBody } : {}),
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export async function runStudioBridgeLoop(
  options: StudioAttachOptions,
  onResult: (result: StudioBridgeResult) => void,
): Promise<0 | 1> {
  do {
    const result = await runStudioBridgeCommand(options);
    onResult(result);
    if (options.once || options.dryRun) {
      return result.exitCode;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(1000, Math.floor(options.intervalMs ?? 5000))));
  } while (true);
}

export async function runStudioCodexServerCommand(options: StudioAttachOptions): Promise<StudioCodexServerResult> {
  const appRoot = resolve(options.workspaceRoot, options.path ?? ".").replace(/\\/g, "/");
  const pkg = readPackageJson(appRoot);
  const app = {
    name: packageName(pkg, appRoot),
    path: appRoot,
    ...(packageTemplate(pkg) ? { template: packageTemplate(pkg) } : {}),
  };
  const proof = inspectCodexAppServer({
    workspaceRoot: appRoot,
    relevant: true,
    forceRefresh: true,
  });
  const schemaGeneration = options.writeSchemas
    ? generateCodexAppServerSchemas({
        workspaceRoot: appRoot,
        dryRun: options.dryRun,
      })
    : generateCodexAppServerSchemas({
        workspaceRoot: appRoot,
        dryRun: true,
      });
  const handshake = options.probeAppServer
    ? await probeCodexAppServerHandshake({
        workspaceRoot: appRoot,
        dryRun: options.dryRun,
        available: proof.available ? true : undefined,
        disabled: proof.state === "disabled",
      })
    : skippedCodexAppServerHandshake({
        reason: "not-requested",
        dryRun: options.dryRun,
      });
  const mergedProof = mergeCodexAppServerHandshakeProof(proof, handshake);
  const ok = (mergedProof.available || mergedProof.state === "disabled") &&
    (!options.writeSchemas || schemaGeneration.ok) &&
    (!options.probeAppServer || handshake.ok);
  const primaryNextActions = options.probeAppServer && mergedProof.available && handshake.ok
    ? options.writeSchemas && schemaGeneration.ok
      ? []
      : schemaGeneration.nextActions
    : options.writeSchemas
      ? schemaGeneration.nextActions
      : proof.nextActions;
  const nextActions = Array.from(new Set([
    ...primaryNextActions,
    ...(!options.probeAppServer ? handshake.nextActions : []),
    ...(options.probeAppServer && !handshake.ok ? handshake.nextActions : []),
  ]));
  return {
    schemaVersion: "0.1.0",
    ok,
    action: "codex-server",
    app,
    proof: mergedProof,
    schemaGeneration,
    handshake,
    commands: codexAppServerCommands(),
    diagnostics: [],
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

function installPlanFor(pkg: Record<string, unknown>): { command: string; args: string[]; label: string } {
  const packageManager = typeof pkg.packageManager === "string" ? pkg.packageManager : "";
  if (packageManager.startsWith("bun")) {
    return { command: "bun", args: ["install"], label: "bun install" };
  }
  if (packageManager.startsWith("pnpm")) {
    return { command: "pnpm", args: ["install"], label: "pnpm install" };
  }
  if (packageManager.startsWith("yarn")) {
    return { command: "yarn", args: ["install"], label: "yarn install" };
  }
  return { command: "npm", args: ["install"], label: "npm install" };
}

function dependencyStatusFor(appRoot: string, pkg: Record<string, unknown>): {
  required: boolean;
  installed: boolean;
  command?: string;
  cwd: string;
} {
  const hasRootPackage = nodeFileSystem.exists(join(appRoot, "package.json"));
  const hasWebPackage = nodeFileSystem.exists(join(appRoot, "web", "package.json"));
  if (!hasRootPackage && !hasWebPackage) {
    return {
      required: false,
      installed: true,
      cwd: appRoot,
    };
  }
  const hasRootNodeModules = nodeFileSystem.exists(join(appRoot, "node_modules"));
  const hasWebNodeModules = nodeFileSystem.exists(join(appRoot, "web", "node_modules"));
  const plan = installPlanFor(pkg);
  return {
    required: true,
    installed: hasRootNodeModules || hasWebNodeModules,
    command: plan.label,
    cwd: appRoot,
  };
}

function runDependencyInstall(appRoot: string, pkg: Record<string, unknown>): {
  ok: boolean;
  exitCode: number;
  command: string;
} {
  const plan = installPlanFor(pkg);
  const result = spawnSync(plan.command, plan.args, {
    cwd: appRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    command: plan.label,
  };
}

function previewStatePath(appRoot: string): string {
  return join(appRoot, ".forge", "studio", "preview.json");
}

function readPreviewState(appRoot: string): { pid?: number; command?: string; previewPort?: number; runtimePort?: number } | null {
  const path = previewStatePath(appRoot);
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    return JSON.parse(nodeFileSystem.readText(path) ?? "{}") as {
      pid?: number;
      command?: string;
      previewPort?: number;
      runtimePort?: number;
    };
  } catch {
    return null;
  }
}

function livePreviewState(appRoot: string, previewPort: number): { pid?: number; command?: string } | null {
  const state = readPreviewState(appRoot);
  if (!state?.pid) {
    return null;
  }
  if (state.previewPort === previewPort && processIsRunning(state.pid)) {
    return { pid: state.pid, command: state.command };
  }
  if (!processIsRunning(state.pid)) {
    nodeFileSystem.remove(previewStatePath(appRoot));
  }
  return null;
}

function writePreviewState(input: {
  appRoot: string;
  pid?: number;
  previewPort: number;
  command: string;
}): void {
  if (!input.pid || !processIsRunning(input.pid)) {
    return;
  }
  nodeFileSystem.mkdirp(join(input.appRoot, ".forge", "studio"));
  nodeFileSystem.writeText(previewStatePath(input.appRoot), `${JSON.stringify({
    pid: input.pid,
    command: input.command,
    previewPort: input.previewPort,
    runtimePort: STUDIO_TARGET_RUNTIME_PORT,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function spawnForgeDev(appRoot: string, previewPort: number): { pid?: number; command: string; alreadyRunning: boolean; error?: string } {
  const existing = livePreviewState(appRoot, previewPort);
  if (existing?.pid) {
    return {
      pid: existing.pid,
      command: existing.command ?? targetAppDevCommand(previewPort),
      alreadyRunning: true,
    };
  }
  const cliEntry = process.argv[1];
  const command = cliEntry ? process.execPath : "forge";
  const args = cliEntry
    ? [cliEntry, "dev", "--port", String(STUDIO_TARGET_RUNTIME_PORT), "--web-port", String(previewPort)]
    : ["dev", "--port", String(STUDIO_TARGET_RUNTIME_PORT), "--web-port", String(previewPort)];
  const label = targetAppDevCommand(previewPort);
  try {
    const child = spawn(command, args, {
      cwd: appRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: !cliEntry && process.platform === "win32",
    });
    child.unref();
    writePreviewState({ appRoot, pid: child.pid, previewPort, command: label });
    return { pid: child.pid, command: label, alreadyRunning: false };
  } catch (error) {
    return {
      command: label,
      alreadyRunning: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function processIsRunning(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function detectListeningProcess(port: number): { pid?: number; command?: string; evidence: string } | null {
  const lsof = spawnSync("lsof", [`-iTCP:${port}`, "-sTCP:LISTEN", "-n", "-P", "-Fp", "-Fc"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (lsof.status === 0 && lsof.stdout) {
    const pid = /^p(\d+)$/m.exec(lsof.stdout)?.[1];
    const command = /^c(.+)$/m.exec(lsof.stdout)?.[1];
    return {
      ...(pid ? { pid: Number(pid) } : {}),
      ...(command ? { command } : {}),
      evidence: "lsof reported a listener on the preview port",
    };
  }
  const ss = spawnSync("ss", ["-ltnp", `sport = :${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  });
  if (ss.status === 0 && ss.stdout) {
    const pid = /pid=(\d+)/.exec(ss.stdout)?.[1];
    const command = /users:\(\("([^"]+)"/.exec(ss.stdout)?.[1];
    if (pid || command) {
      return {
        ...(pid ? { pid: Number(pid) } : {}),
        ...(command ? { command } : {}),
        evidence: "ss reported a listener on the preview port",
      };
    }
  }
  return null;
}

function bridgeStatePath(appRoot: string): string {
  return join(appRoot, ".forge", "studio", "bridge.json");
}

function readBridgeState(appRoot: string): { pid?: number; command?: string } | null {
  const path = bridgeStatePath(appRoot);
  if (!nodeFileSystem.exists(path)) {
    return null;
  }
  try {
    const parsed = JSON.parse(nodeFileSystem.readText(path) ?? "{}") as { pid?: number; command?: string };
    return parsed;
  } catch {
    return null;
  }
}

function spawnForgeStudioBridge(input: {
  appRoot: string;
  previewPort: number;
  targets: string[];
  studioUrl: string;
  intervalMs: number;
  probeAppServer?: boolean;
}): { pid?: number; command: string; alreadyRunning: boolean; error?: string } {
  const existing = readBridgeState(input.appRoot);
  if (existing?.pid && processIsRunning(existing.pid)) {
    return {
      pid: existing.pid,
      command: existing.command ?? "forge studio bridge",
      alreadyRunning: true,
    };
  }

  const cliEntry = process.argv[1];
  const command = cliEntry ? process.execPath : "forge";
  const targetArgs = input.targets.flatMap((target) => ["--target", target]);
  const args = [
    ...(cliEntry ? [cliEntry] : []),
    "studio",
    "bridge",
    input.appRoot,
    "--preview-port",
    String(input.previewPort),
    ...targetArgs,
    "--studio-url",
    input.studioUrl,
    "--interval-ms",
    String(input.intervalMs),
    "--json",
    ...(input.probeAppServer ? ["--probe-codex-server"] : []),
  ];
  const label = `forge ${args.filter((arg) => arg !== cliEntry).join(" ")}`;
  try {
    nodeFileSystem.mkdirp(join(input.appRoot, ".forge", "studio"));
    const child = spawn(command, args, {
      cwd: input.appRoot,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: !cliEntry && process.platform === "win32",
    });
    child.unref();
    const state = {
      pid: child.pid,
      command: label,
      studioUrl: input.studioUrl,
      previewPort: input.previewPort,
      intervalMs: input.intervalMs,
      targets: input.targets,
      startedAt: new Date().toISOString(),
    };
    nodeFileSystem.writeText(bridgeStatePath(input.appRoot), `${JSON.stringify(state, null, 2)}\n`);
    return { pid: child.pid, command: label, alreadyRunning: false };
  } catch (error) {
    return {
      command: label,
      alreadyRunning: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function waitForPreviewAfterStart(
  preview: Omit<StudioAttachResult["preview"], "status">,
  startCommand: string,
): Promise<StudioAttachResult["preview"]["status"]> {
  let status = previewStatus("not-running", `preview is not reachable at ${preview.url}`, [startCommand, "forge dev --once --json"]);
  for (let attempt = 0; attempt < 20; attempt++) {
    await sleep(attempt === 0 ? 500 : 1000);
    status = await probeStudioPreview(preview, {
      dryRun: false,
      startCommand,
      timeoutMs: 750,
    });
    if (status.state === "reachable") {
      return status;
    }
  }
  return status;
}

export async function runStudioDoctorCommand(options: StudioAttachOptions): Promise<StudioDoctorResult> {
  const snapshot = await runStudioSnapshotCommand(options);
  const hookProofs = snapshot.proofs.hooks;
  const delta = snapshot.proofs.delta as { recording?: boolean; diagnostics?: Diagnostic[]; exitCode?: number } | undefined;
  const hookReady = hookProofs.some((proof) => proof.ok && (proof.nativeSignals ?? proof.usefulSignals ?? 0) > 0);
  const hookMemoryUnavailable = hookProofs.some((proof) =>
    proof.deltaWritable === false ||
    proof.approvalStatus === "memory-unavailable" ||
    (proof.diagnostics ?? []).some((diag) =>
      ["FORGE_AGENT_MEMORY_UNAVAILABLE", "FORGE_DELTA_STORE_UNAVAILABLE", "FORGE_DELTA_BUSY"].includes(diag.code)
    )
  );
  const hookWaitingForApproval = hookProofs.some((proof) =>
    proof.approvalRequired === true || proof.approvalStatus === "waiting-for-user-trust"
  );
  const hookInstalled = hookProofs.some((proof) => proof.installed === true);
  const codexAppServer = snapshot.proofs.codexAppServer;
  const codexHandshake = codexAppServer?.handshake;
  const codexHandshakeFailed = codexHandshake?.attempted === true && codexHandshake.ok !== true;
  const checks: StudioDoctorResult["checks"] = [
    {
      name: "preview",
      ok: snapshot.preview.status.state === "reachable",
      status: snapshot.preview.status.state === "reachable" ? "ok" : "warning",
      message: snapshot.preview.status.reason,
      suggestedCommands: snapshot.preview.status.suggestedCommands,
    },
    {
      name: "generated",
      ok: snapshot.posture.generated?.ok === true,
      status: snapshot.posture.generated?.ok === true ? "ok" : "failed",
      message: snapshot.posture.generated?.message ?? snapshot.posture.reason,
      suggestedCommands: ["forge generate --check --json", "forge generate"],
    },
    {
      name: "hooks",
      ok: hookReady,
      status: hookReady
        ? "ok"
        : hookMemoryUnavailable || hookWaitingForApproval || hookInstalled
          ? "warning"
          : "failed",
      message: hookReady
        ? "hooks are installed and trusted native agent signals are visible"
        : hookMemoryUnavailable
          ? "hooks are installed, but Agent Memory/DeltaDB is unavailable so hook trust cannot be verified"
        : hookWaitingForApproval
          ? "hooks are installed, but no trusted native Codex hook signal is visible yet"
          : hookInstalled
            ? "hooks are installed, but no trusted native agent signal is visible yet"
          : "no target reported a ready hook bridge",
      suggestedCommands: hookProofs.flatMap((proof) => proof.nextActions ?? [`forge agent hooks status --target ${proof.target} --json`]),
    },
    {
      name: "deltadb",
      ok: delta?.exitCode === 0 && delta?.recording !== false,
      status: delta?.exitCode === 0 && delta?.recording !== false ? "ok" : "warning",
      message: delta?.exitCode === 0 ? "DeltaDB status is readable" : "DeltaDB status needs attention",
      suggestedCommands: ["forge delta status --json", "forge agent hooks smoke --target codex --json"],
    },
    ...(codexAppServer
      ? [{
          name: "codex-app-server",
          ok: !codexHandshakeFailed,
          status: codexHandshakeFailed
            ? "failed" as const
            : codexAppServer.available
              ? "ok" as const
              : "warning" as const,
          message: codexHandshakeFailed
            ? `Codex app-server handshake failed: ${codexHandshake?.error ?? "initialize did not complete"}`
            : codexHandshake?.initialized
              ? "Codex app-server initialized over stdio for deep Studio integration"
              : codexAppServer.available
                ? "Codex app-server is available for deep Studio integration"
            : "Codex app-server is not available yet; Studio will rely on hooks, MCP, and Forge snapshots",
          suggestedCommands: codexAppServer.nextActions,
        }]
      : []),
  ];
  const ok = checks.every((check) => check.ok);
  return {
    schemaVersion: "0.1.0",
    ok,
    action: "doctor",
    app: snapshot.app,
    checks,
    snapshot,
    diagnostics: snapshot.diagnostics,
    nextActions: checks.flatMap((check) => check.ok ? [] : check.suggestedCommands).slice(0, 12),
    exitCode: ok ? 0 : 1,
  };
}

export async function runStudioOpenCommand(options: StudioAttachOptions): Promise<StudioOpenResult> {
  const attach = await runStudioAttachCommand(options);
  const appRoot = attach.app.path;
  const pkg = readPackageJson(appRoot);
  const diagnostics: Diagnostic[] = [...attach.diagnostics];
  const shouldStart = options.start !== false;
  const shouldBridge = options.bridge !== false;
  const previewPort = attach.preview.port ?? localPreviewPort(attach.preview.url);
  const commands = {
    ...attach.commands,
    attach: attachCommandFor(attach.targets, previewPort ?? 5174),
    bridge: `forge studio bridge . --preview-port ${previewPort ?? 5174} ${attach.targets.map((target) => `--target ${target}`).join(" ")} --studio-url ${normalizeStudioUrl(options.studioUrl)}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
    doctor: `forge studio doctor . --preview-port ${previewPort ?? 5174} ${attach.targets.map((target) => `--target ${target}`).join(" ")}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
    open: `forge studio open . --preview-port ${previewPort ?? 5174} ${attach.targets.map((target) => `--target ${target}`).join(" ")}${options.probeAppServer ? " --probe-codex-server" : ""} --json`,
  };

  const dependencyStatus = dependencyStatusFor(appRoot, pkg);
  const install: StudioOpenResult["previewAutomation"]["install"] = {
    required: dependencyStatus.required,
    installed: dependencyStatus.installed,
    attempted: false,
    ...(dependencyStatus.command ? { command: dependencyStatus.command } : {}),
    cwd: appRoot,
  };

  if (dependencyStatus.required && !dependencyStatus.installed) {
    if (options.install && !options.dryRun) {
      const installed = runDependencyInstall(appRoot, pkg);
      install.attempted = true;
      install.ok = installed.ok;
      install.exitCode = installed.exitCode;
      install.command = installed.command;
      install.installed = installed.ok;
      if (!installed.ok) {
        diagnostics.push(createDiagnostic({
          severity: "error",
          code: "FORGE_STUDIO_DEPENDENCY_INSTALL_FAILED",
          message: `dependency install failed in ${appRoot} with exit code ${installed.exitCode}`,
          fixHint: `Run ${installed.command} in the target app, then retry forge studio open.`,
          suggestedCommands: [installed.command, commands.open],
        }));
      }
    } else {
      diagnostics.push(createDiagnostic({
        severity: "warning",
        code: "FORGE_STUDIO_DEPENDENCIES_MISSING",
        message: `target app dependencies are not installed in ${appRoot}`,
        fixHint: options.dryRun
          ? "dry-run does not install dependencies; rerun with --install when you want ForgeOS to install them."
          : "Run the install command yourself, or rerun forge studio open with --install.",
        suggestedCommands: [
          dependencyStatus.command ?? "npm install",
          `${commands.open} --install`,
        ],
      }));
    }
  }

  let started = false;
  let startAttempted = false;
  let skippedReason: StudioOpenResult["previewAutomation"]["skippedReason"];
  let previewStatusAfter = attach.preview.status;
  let pid: number | undefined;
  let previewOwner: StudioOpenResult["previewAutomation"]["owner"];

  if (attach.preview.status.state === "reachable") {
    skippedReason = "already-running";
    const listener = previewPort ? detectListeningProcess(previewPort) : null;
    previewOwner = listener
      ? {
          kind: "external-process",
          ...(listener.pid ? { pid: listener.pid } : {}),
          ...(listener.command ? { command: listener.command } : {}),
          evidence: `${attach.preview.url} was reachable before ForgeOS attempted startup; ${listener.evidence}`,
        }
      : {
          kind: "preexisting-reachable-preview",
          evidence: `${attach.preview.url} was reachable before ForgeOS attempted to start the target app`,
        };
  } else if (options.dryRun) {
    skippedReason = "dry-run";
    previewOwner = {
      kind: "dry-run",
      evidence: "dry-run did not inspect or start a preview process",
    };
  } else if (!shouldStart) {
    skippedReason = "disabled";
  } else if (!previewPort) {
    skippedReason = "non-local-preview";
    diagnostics.push(createDiagnostic({
      severity: "warning",
      code: "FORGE_STUDIO_PREVIEW_NOT_LOCAL",
      message: `cannot auto-start non-local preview URL ${attach.preview.url}`,
      fixHint: "Use --preview-port for a local target app preview, or start the preview manually.",
      suggestedCommands: [commands.startTargetApp, commands.probePreview],
    }));
  } else if (install.required && !install.installed) {
    skippedReason = install.attempted ? "install-failed" : "missing-dependencies";
  } else {
    startAttempted = true;
    const spawned = spawnForgeDev(appRoot, previewPort);
    if (spawned.alreadyRunning) {
      startAttempted = false;
      skippedReason = "already-running";
      pid = spawned.pid;
      previewOwner = {
        kind: "forge-managed",
        ...(pid ? { pid } : {}),
        evidence: "live .forge/studio/preview.json matched the preview port and process is alive",
        statePath: normalizePath(relative(appRoot, previewStatePath(appRoot))),
      };
      previewStatusAfter = await probeStudioPreview(attach.preview, {
        dryRun: false,
        startCommand: commands.startTargetApp,
        timeoutMs: 750,
      });
    } else if (spawned.error) {
      diagnostics.push(createDiagnostic({
        severity: "error",
        code: "FORGE_STUDIO_PREVIEW_START_FAILED",
        message: `failed to start target app preview: ${spawned.error}`,
        fixHint: `Run ${commands.startTargetApp} in ${appRoot}.`,
        suggestedCommands: [commands.startTargetApp, commands.probePreview],
      }));
    } else {
      started = true;
      pid = spawned.pid;
      previewOwner = {
        kind: "forge-managed",
        ...(pid ? { pid } : {}),
        evidence: "ForgeOS started the target preview for this studio open request",
        statePath: normalizePath(relative(appRoot, previewStatePath(appRoot))),
      };
      previewStatusAfter = await waitForPreviewAfterStart(attach.preview, commands.startTargetApp);
      if (previewStatusAfter.state !== "reachable") {
        diagnostics.push(createDiagnostic({
          severity: "warning",
          code: "FORGE_STUDIO_PREVIEW_START_PENDING",
          message: `started ${commands.startTargetApp}, but ${attach.preview.url} is not reachable yet`,
          fixHint: "The dev server may still be compiling. Re-run forge studio doctor after it settles.",
          suggestedCommands: [commands.probePreview, commands.doctor],
        }));
      }
    }
  }

  const preview = {
    ...attach.preview,
    status: previewStatusAfter,
  };

  if (!options.dryRun && attach.filesWritten.includes(attach.manifestPath)) {
    nodeFileSystem.writeText(
      join(appRoot, attach.manifestPath),
      renderManifest({
        app: attach.app,
        preview,
        posture: attach.posture,
        targets: attach.targets,
        commands: attach.commands,
      }),
    );
  }

  let bridgeResult: StudioBridgeResult | undefined;
  let autoBridge: ReturnType<typeof spawnForgeStudioBridge> | undefined;
  if (shouldBridge && !options.dryRun) {
    const intervalMs = Math.max(1000, Math.floor(options.intervalMs ?? 5000));
    bridgeResult = await runStudioBridgeCommand({
      ...options,
      path: appRoot,
      previewUrl: preview.url,
      previewPort,
      once: true,
      targets: attach.targets,
    });
    diagnostics.push(...bridgeResult.diagnostics);
    if (!options.dryRun && bridgeResult.ok && preview.status.state === "reachable" && previewPort) {
      autoBridge = spawnForgeStudioBridge({
        appRoot,
        previewPort,
        targets: attach.targets,
        studioUrl: normalizeStudioUrl(options.studioUrl),
        intervalMs,
        probeAppServer: options.probeAppServer,
      });
      if (autoBridge.error) {
        diagnostics.push(createDiagnostic({
          severity: "warning",
          code: "FORGE_STUDIO_BRIDGE_AUTOSTART_FAILED",
          message: `initial snapshot was delivered, but the live Studio bridge could not be started: ${autoBridge.error}`,
          fixHint: `Run ${autoBridge.command} in ${appRoot}.`,
          suggestedCommands: [autoBridge.command, commands.doctor],
        }));
      }
    }
  }

  const bridge = bridgeResult
    ? {
        attempted: true,
        ok: bridgeResult.ok,
        posted: bridgeResult.posted,
        dryRun: bridgeResult.dryRun,
        mode: autoBridge && !autoBridge.error ? "watch" as const : bridgeResult.mode,
        autoStarted: Boolean(autoBridge && !autoBridge.error && !autoBridge.alreadyRunning),
        alreadyRunning: Boolean(autoBridge?.alreadyRunning),
        ...(autoBridge?.command ? { command: autoBridge.command } : {}),
        cwd: appRoot,
        intervalMs: Math.max(1000, Math.floor(options.intervalMs ?? 5000)),
        ...(autoBridge?.pid ? { pid: autoBridge.pid } : {}),
        studioUrl: bridgeResult.studioUrl,
        endpoint: bridgeResult.endpoint,
        diagnostics: bridgeResult.diagnostics,
        nextActions: bridgeResult.nextActions,
      }
    : shouldBridge && options.dryRun
      ? {
          attempted: true,
          ok: true,
          posted: false,
          dryRun: true,
          mode: "watch" as const,
          autoStarted: false,
          alreadyRunning: false,
          command: commands.bridge,
          cwd: appRoot,
          intervalMs: Math.max(1000, Math.floor(options.intervalMs ?? 5000)),
          studioUrl: normalizeStudioUrl(options.studioUrl),
          endpoint: `${normalizeStudioUrl(options.studioUrl)}/commands/ingestStudioSnapshot`,
          diagnostics: [],
          nextActions: [commands.bridge, commands.doctor],
        }
    : {
        attempted: false,
        ok: true,
        posted: false,
        dryRun: options.dryRun,
        mode: "once" as const,
        autoStarted: false,
        alreadyRunning: false,
        studioUrl: normalizeStudioUrl(options.studioUrl),
        diagnostics: [],
        nextActions: [`forge studio bridge . --preview-port ${previewPort ?? 5174} --target ${attach.targets[0] ?? "codex"} --json`],
      };

  const previewReady = options.dryRun || preview.status.state === "reachable";
  const ok = attach.ok &&
    previewReady &&
    bridge.ok &&
    diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  const nextActions = Array.from(new Set([
    ...(install.required && !install.installed && install.command ? [install.command] : []),
    ...(preview.status.state === "reachable" ? [] : [commands.startTargetApp, commands.probePreview]),
    ...(bridge.attempted && !bridge.ok ? bridge.nextActions : []),
    commands.doctor,
    ...attach.commands.checkHooks,
  ])).slice(0, 12);

  return {
    schemaVersion: "0.1.0",
    ok,
    action: "open",
    app: attach.app,
    preview,
    attach,
    previewAutomation: {
      attempted: startAttempted,
      started,
      alreadyRunning: skippedReason === "already-running",
      ...(skippedReason ? { skippedReason } : {}),
      command: commands.startTargetApp,
      cwd: appRoot,
      ...(pid ? { pid } : {}),
      ...(previewOwner ? { owner: previewOwner } : {}),
      statusBefore: attach.preview.status,
      statusAfter: preview.status,
      install,
    },
    bridge,
    commands,
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export function formatStudioAttachJson(result: StudioAttachResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioOpenJson(result: StudioOpenResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioSnapshotJson(result: StudioSnapshotResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioWatchJson(result: StudioWatchResult): string {
  return `${JSON.stringify({
    schemaVersion: result.schemaVersion,
    event: result.stream.event,
    ok: result.ok,
    stream: result.stream,
    snapshot: result.snapshot,
    exitCode: result.exitCode,
  }, null, 2)}\n`;
}

export function formatStudioBridgeJson(result: StudioBridgeResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioCodexServerJson(result: StudioCodexServerResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioBridgeEventJson(result: StudioBridgeResult): string {
  return `${JSON.stringify({
    schemaVersion: result.schemaVersion,
    event: "studio.bridge",
    ok: result.ok,
    posted: result.posted,
    dryRun: result.dryRun,
    studioUrl: result.studioUrl,
    provider: result.provider,
    target: result.target,
    snapshot: result.snapshot,
    diagnostics: result.diagnostics,
    exitCode: result.exitCode,
  })}\n`;
}

export function formatStudioDoctorJson(result: StudioDoctorResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export function formatStudioAttachHuman(result: StudioAttachResult): string {
  const lines = [
    `Forge Studio attach: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    `Preview: ${result.preview.url}`,
    `Preview status: ${result.preview.status.state} (${result.preview.status.reason})`,
    `Preview note: ${result.preview.note}`,
    `Posture: ${result.posture.state} (${result.posture.reason})`,
    ...(result.posture.generated ? [`Generated: ${result.posture.generated.state} (${result.posture.generated.changedFiles} changed)`] : []),
    `Start app: ${result.commands.startTargetApp}`,
    `Start cwd: ${result.commands.startTargetAppCwd}`,
    `Targets: ${result.targets.join(", ")}`,
    `Manifest: ${result.manifestPath}`,
    "",
    "Next:",
    ...result.nextActions.map((action) => `  ${action}`),
  ];
  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    lines.push(...result.diagnostics.slice(0, 8).map((diag) => `  ${diag.severity} ${diag.code}: ${diag.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatStudioOpenHuman(result: StudioOpenResult): string {
  const bridgeStatus = result.bridge.attempted
    ? result.bridge.posted
      ? "posted"
      : result.bridge.dryRun
        ? "dry-run"
        : result.bridge.ok
          ? "ready"
          : "needs attention"
    : "skipped";
  const previewAutomation = result.previewAutomation.started
    ? `started${result.previewAutomation.pid ? ` (pid ${result.previewAutomation.pid})` : ""}`
    : result.previewAutomation.skippedReason ?? "not started";
  const owner = result.previewAutomation.owner
    ? `${result.previewAutomation.owner.kind}${result.previewAutomation.owner.pid ? ` (pid ${result.previewAutomation.owner.pid})` : ""}`
    : "unknown";
  const lines = [
    `Forge Studio open: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    `Preview: ${result.preview.url}`,
    `Preview status: ${result.preview.status.state} (${result.preview.status.reason})`,
    `Preview automation: ${previewAutomation}`,
    `Preview owner: ${owner}`,
    `Bridge: ${bridgeStatus} (${result.bridge.studioUrl})`,
    `Start cwd: ${result.previewAutomation.cwd}`,
    "",
    "Next:",
    ...result.nextActions.map((action) => `  ${action}`),
  ];
  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    lines.push(...result.diagnostics.slice(0, 10).map((diag) => `  ${diag.severity} ${diag.code}: ${diag.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatStudioSnapshotHuman(result: StudioSnapshotResult): string {
  const changedSummary = result.changed.summary as { changedFiles?: number; humanFiles?: number; generatedFiles?: number } | undefined;
  const lines = [
    `Forge Studio snapshot: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    `Preview: ${result.preview.url}`,
    `Preview status: ${result.preview.status.state} (${result.preview.status.reason})`,
    `Posture: ${result.posture.state} (${result.posture.reason})`,
    ...(result.posture.generated ? [`Generated: ${result.posture.generated.state} (${result.posture.generated.changedFiles} changed)`] : []),
    `Changed: ${changedSummary?.changedFiles ?? 0} (${changedSummary?.humanFiles ?? 0} authored, ${changedSummary?.generatedFiles ?? 0} generated)`,
    `Start app: ${result.commands.startTargetApp}`,
    `Start cwd: ${result.commands.startTargetAppCwd}`,
    "",
    "Next:",
    ...result.nextActions.map((action) => `  ${action}`),
  ];
  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    lines.push(...result.diagnostics.slice(0, 8).map((diag) => `  ${diag.severity} ${diag.code}: ${diag.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatStudioWatchHuman(result: StudioWatchResult): string {
  return [
    `Forge Studio watch: ${result.ok ? "ready" : "needs attention"}`,
    `Event: ${result.stream.event}`,
    `Mode: ${result.stream.mode}`,
    `Preview: ${result.snapshot.preview.url}`,
    `Follow: ${result.stream.followCommand}`,
    "",
  ].join("\n");
}

export function formatStudioBridgeHuman(result: StudioBridgeResult): string {
  const lines = [
    `Forge Studio bridge: ${result.ok ? "delivered" : "needs attention"}`,
    `Studio runtime: ${result.studioUrl}`,
    `Provider: ${result.provider}`,
    `Preview: ${result.snapshot.preview.url}`,
    `Posted: ${result.posted ? "yes" : result.dryRun ? "dry-run" : "no"}`,
    `Snapshot posture: ${result.snapshot.posture.state} (${result.snapshot.posture.reason})`,
    "",
    "Next:",
    ...result.nextActions.map((action) => `  ${action}`),
  ];
  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    lines.push(...result.diagnostics.slice(0, 8).map((diag) => `  ${diag.severity} ${diag.code}: ${diag.message}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatStudioCodexServerHuman(result: StudioCodexServerResult): string {
  const lines = [
    `Forge Studio Codex app-server: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    `State: ${result.proof.state}`,
    `Available: ${result.proof.available ? "yes" : "no"}`,
    `Inspect: ${result.commands.inspect}`,
    `Schemas: ${result.commands.generateTypes}`,
    `Schema generation: ${result.schemaGeneration.attempted ? result.schemaGeneration.ok ? "written" : "failed" : "planned"}`,
    `Handshake: ${result.handshake.attempted ? result.handshake.ok ? "initialized" : "failed" : result.handshake.skippedReason ?? "not requested"}`,
    `Connect: ${result.commands.connectStdio}`,
    "",
    "Checks:",
    ...result.proof.checks.map((check) => {
      const status = check.status === "ok" ? "OK" : check.status.toUpperCase();
      return `  ${status} ${check.name}: ${check.message}`;
    }),
  ];
  if (result.nextActions.length > 0) {
    lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  }
  return `${lines.join("\n")}\n`;
}

export function formatStudioDoctorHuman(result: StudioDoctorResult): string {
  const lines = [
    `Forge Studio doctor: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    "",
    "Checks:",
    ...result.checks.map((check) => {
      const status = check.status === "ok" ? "OK" : check.status.toUpperCase();
      return `  ${status} ${check.name}: ${check.message}`;
    }),
  ];
  if (result.nextActions.length > 0) {
    lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  }
  return `${lines.join("\n")}\n`;
}
