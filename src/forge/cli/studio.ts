import { createConnection } from "node:net";
import { basename, join, resolve } from "node:path";
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

export interface StudioAttachOptions {
  workspaceRoot: string;
  subcommand?: "attach" | "snapshot" | "watch" | "open" | "doctor";
  path?: string;
  previewUrl?: string;
  previewPort?: number;
  targets: string[];
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
    hooks: Array<{ target: string; ok: boolean; installed?: boolean; usefulSignals?: number; lastSignal?: unknown; nextActions?: string[] }>;
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
    mode: "single-snapshot";
    event: "studio.snapshot";
    note: string;
    followCommand: string;
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
      suggestedCommands: ["forge studio attach . --preview-port 5174 --target codex --json", "forge dev --web-port 5174"],
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

function forgeSourcePresent(appRoot: string): boolean {
  return nodeFileSystem.exists(join(appRoot, "src", "forge"));
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
    const generated = await runGenerate({
      workspaceRoot: appRoot,
      check: true,
      dryRun: false,
      json: false,
      concurrency: 4,
    });
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
        usefulSignals: result.usefulSignals,
        ...(result.lastSignal ? { lastSignal: result.lastSignal } : {}),
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
      ...input.commands.checkHooks,
    ],
    ...(input.posture.diffPlan ? { diffPlan: input.posture.diffPlan } : {}),
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
    startTargetApp: `forge dev --web-port ${initialPreview.port ?? 5174}`,
    startTargetAppCwd: appRoot,
    openPreview: initialPreview.url,
    probePreview: "forge dev --once --json",
    installHooks: targets.map((target) => `forge agent onboard --target ${target} --json`),
    checkHooks: targets.map((target) => `forge agent hooks status --target ${target} --json`),
    openContext: "forge agent context --current --json",
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
    startTargetApp: `forge dev --web-port ${initialPreview.port ?? 5174}`,
    startTargetAppCwd: appRoot,
    openPreview: initialPreview.url,
    probePreview: "forge dev --once --json",
    installHooks: targets.map((target) => `forge agent onboard --target ${target} --json`),
    checkHooks: targets.map((target) => `forge agent hooks status --target ${target} --json`),
    openContext: "forge agent context --current --json",
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
    watch: `forge studio watch . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")} --json`,
    doctor: `forge studio doctor . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")} --json`,
    open: `forge studio open . --preview-port ${attachPreviewPort} ${targets.map((target) => `--target ${target}`).join(" ")} --json`,
  };
  const hookProofs = await collectHookProofs(appRoot, targets);
  const delta = await runDeltaStatus(appRoot);
  const contextPacket = contextPacketFor({ appRoot, posture, commands });
  const ok = posture.state !== "needs-attention" && changed.ok &&
    diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  const nextActions = [
    commands.startTargetApp,
    commands.probePreview,
    commands.changed,
    commands.doctor,
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
      delta,
    },
    diagnostics,
    nextActions,
    exitCode: ok ? 0 : 1,
  };
}

export async function runStudioWatchCommand(options: StudioAttachOptions): Promise<StudioWatchResult> {
  const snapshot = await runStudioSnapshotCommand(options);
  return {
    schemaVersion: "0.1.0",
    ok: snapshot.ok,
    action: "watch",
    stream: {
      mode: "single-snapshot",
      event: "studio.snapshot",
      note: "This command emits a Studio-compatible snapshot event. Long-running file streaming is provided by forge dev --watch --json today.",
      followCommand: "forge dev --watch --json",
    },
    snapshot,
    exitCode: snapshot.exitCode,
  };
}

export async function runStudioDoctorCommand(options: StudioAttachOptions): Promise<StudioDoctorResult> {
  const snapshot = await runStudioSnapshotCommand(options);
  const hookProofs = snapshot.proofs.hooks;
  const delta = snapshot.proofs.delta as { recording?: boolean; diagnostics?: Diagnostic[]; exitCode?: number } | undefined;
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
      ok: hookProofs.some((proof) => proof.ok && (proof.usefulSignals ?? 0) > 0),
      status: hookProofs.some((proof) => proof.ok && (proof.usefulSignals ?? 0) > 0)
        ? "ok"
        : hookProofs.some((proof) => proof.ok)
          ? "warning"
          : "failed",
      message: hookProofs.some((proof) => proof.ok && (proof.usefulSignals ?? 0) > 0)
        ? "hooks are installed and useful agent signals are visible"
        : hookProofs.some((proof) => proof.ok)
          ? "hooks are installed, but no useful agent signal is visible yet"
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

export async function runStudioOpenCommand(options: StudioAttachOptions): Promise<StudioAttachResult> {
  return runStudioAttachCommand(options);
}

export function formatStudioAttachJson(result: StudioAttachResult): string {
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

export function formatStudioDoctorHuman(result: StudioDoctorResult): string {
  const lines = [
    `Forge Studio doctor: ${result.ok ? "ready" : "needs attention"}`,
    `App: ${result.app.name}`,
    `Path: ${result.app.path}`,
    "",
    "Checks:",
    ...result.checks.map((check) => `  ${check.ok ? "OK" : check.status.toUpperCase()} ${check.name}: ${check.message}`),
  ];
  if (result.nextActions.length > 0) {
    lines.push("", "Next:", ...result.nextActions.map((action) => `  ${action}`));
  }
  return `${lines.join("\n")}\n`;
}
