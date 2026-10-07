import { readFileSync, realpathSync, statSync } from "node:fs";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isAbsolute, relative, resolve } from "node:path";
import { LocalTaskService } from "../agent-fabric/local-task-service.ts";
import { LocalChangeReviewService } from "../agent-fabric/local-change-review-service.ts";
import { LOCAL_CODING_MODEL, LOCAL_CODING_TARGET } from "../agent-fabric/local-task-contract.ts";
import { isManagedRunAction, requestManagedRun, type ManagedRunAction, isAttachedTaskAction, isAttachedTaskRead, requestAttachedTask, type AttachedTaskAction, requestLocalMemory, requestLocalTask, serveLocalTasks, type LocalMemoryAction, type LocalTaskAction } from "../agent-fabric/local-task-server.ts";
import { runAdaptiveCommand, type AdaptiveCliOptions } from "./adaptive.ts";
import { listFabricProjects, registerFabricProject, resolveFabricRoot } from "../agent-fabric/project-registry.ts";
import { ensureFabricOwner, fabricProjectDoctor } from "../agent-fabric/project-runtime.ts";
import { isProgramRunAction, requestProgramRun, type ProgramRunAction } from "../agent-fabric/local-task-server.ts";

export interface FabricCliOptions {
  subcommand: ProgramRunAction | ManagedRunAction | AttachedTaskAction | "install-skill" | "doctor" | "ensure-owner" | "project-register" | "project-list" | "capabilities" | "propose" | "status" | "evidence" | "review" | "run" | "cancel" | "reconcile" | "verify" | "recover-verification" | "review-result" | "serve" | "memory-add" | "memory-list" | "memory-delete" | "change-propose" | "change-status" | "change-review" | "change-evidence" | AdaptiveCliOptions["subcommand"];
  workspaceRoot: string;
  json: boolean;
  file?: string;
  taskId?: string;
  runId?: string;
  projectId?: string;
  dryRun?: boolean;
  channel?: "canary" | "stable";
}

export async function runFabricCommand(options: FabricCliOptions): Promise<number> {
  if (options.subcommand.startsWith("adaptive-")) return runAdaptiveCommand(options as AdaptiveCliOptions);
  if (options.subcommand === "install-skill") {
    try {
      const installer = fileURLToPath(new URL("../../../scripts/install-agent-fabric-skill.mjs", import.meta.url));
      const { stdout } = await promisify(execFile)(process.execPath, [installer, ...(options.dryRun ? ["--dry-run"] : [])], { windowsHide: true, timeout: 30_000 });
      process.stdout.write(stdout);
      return 0;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Skill installation failed" })}\n`);
      return 1;
    }
  }
  if (["doctor", "ensure-owner", "project-register", "project-list"].includes(options.subcommand)) {
    try {
      const status = options.subcommand === "project-list" ? await listFabricProjects()
        : options.subcommand === "project-register" ? await registerFabricProject(options.workspaceRoot, { id: options.projectId })
        : options.subcommand === "doctor" ? await fabricProjectDoctor(options.workspaceRoot)
        : await ensureFabricOwner(options.workspaceRoot);
      const ok = !(options.subcommand === "doctor" && "ok" in status && !status.ok);
      process.stdout.write(`${JSON.stringify({ ok, status }, null, 2)}\n`);
      return ok ? 0 : 1;
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Agent Fabric project operation failed" })}\n`);
      return 1;
    }
  }
  if (options.subcommand === "capabilities") {
    const result = {
      ok: true, schemaVersion: 1, runtime: "local-pilot",
      proposal: true, ownerReview: true, durableStatus: true,
      codingWorker: true, ownerServer: true,
      codingWorkerModel: { targetId: LOCAL_CODING_TARGET, modelId: LOCAL_CODING_MODEL,
        proposalField: "requestedModelId" },
      sandboxVerification: { supported: true, localReadiness: "not_checked" },
      cancellation: { supported: true, concurrentRequestsRequireOwnerServer: true,
        activeModelStopIsBestEffort: true },
      accompaniedTasks: { supported: true, runningOwnerRequired: true, nativeSessionAssociation: true,
        evidenceProvenance: "agent_reported", automaticDispatch: false, managedWorkers: false, workflowExecution: "caller_driven" },
      managedExecution: { supported: true, runningOwnerRequired: true, scheduler: "owner_managed",
        executors: ["codex", "command"], startDispatchesWork: true, boundedEventWaitMs: 30_000,
        codexMayConsumeCredits: true, controls: ["steer", "pause", "resume", "cancel", "reconcile"],
        environment: { automaticPreparation: true, isolatedDependencies: true, cacheReuse: "verified_copy", ignoreScriptsDefault: true } },
      portableProjects: { supported: true, rootResolution: "git_toplevel", ownerPerRepository: true, optionalProfile: ".forge/fabric.json", mcpProjectRouting: "registered_project_id" },
      consequentialEffects: true,
      effectsByMode: { legacy: "owner_reviewed_local_pilot", accompanied: "caller_driven_records",
        managed: "process_execution_and_optional_local_publication" },
      privateMemory: "owner_cli_only",
      programWorkflows: { supported: true, schemaVersion: 2, operatorVersion: 2, optIn: true, registry: ".forge/fabric-programs.json", staticDSL: true, operators: ["agent", "command", "map", "branch", "loop", "repair", "compose", "gate", "subworkflow", "waitEvent", "value", "sequence", "parallel"], replan: ["barrier", "additive", "fenced-global-barrier"], sdkOutputReuse: "same-run-completed", ownerRequired: true },
      adaptiveHarness: { twoProcessDataOnly: true, ownerReview: true, durableReadback: true,
        selectedDataProfile: "optional_canary_or_stable" },
      adversarialChangeReview: { propose: true, status: true, evidence: true,
        reviewer: "codex_cli_owner_command_only", automaticPaidReview: false },
      mcpTaskMutation: "mode_specific", mcpDispatch: { legacy: "proposal_only",
        accompanied: "caller_driven_records", managed: "run_start_dispatches_work" }, mcpEvidence: true,
      nativeCodexHookProofRequired: true,
    };
    process.stdout.write(options.json ? `${JSON.stringify(result, null, 2)}\n` :
      "Agent Fabric local pilot: proposal, owner review, bounded Ollama coding, and durable status are available.\n");
    return 0;
  }

  let service: LocalTaskService | undefined;
  let changeService: LocalChangeReviewService | undefined;
  try {
    if (isProgramRunAction(options.subcommand)) {
      let body: Record<string, unknown>;
      if (["program-status", "program-history", "program-explain"].includes(options.subcommand)) body = { runId: options.runId ?? "" };
      else {
        if (!options.file) throw new Error("A program request file is required");
        const root = await resolveFabricRoot(options.workspaceRoot), file = realpathSync(resolve(root, options.file)), relation = relative(root, file);
        if (!relation || relation.startsWith("..") || isAbsolute(relation) || statSync(file).size > 40 * 1024) throw new Error("Program request must be a bounded file inside the project");
        body = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      }
      const status = await requestProgramRun(await resolveFabricRoot(options.workspaceRoot), options.subcommand, body);
      process.stdout.write(`${JSON.stringify({ ok: true, status }, null, 2)}\n`); return 0;
    }
    const repositoryRoot = isManagedRunAction(options.subcommand) || isAttachedTaskAction(options.subcommand) || options.subcommand === "serve"
      ? await resolveFabricRoot(options.workspaceRoot) : realpathSync(options.workspaceRoot);
    if (isManagedRunAction(options.subcommand)) {
      let body: Record<string, unknown>;
      if (options.subcommand === "run-status") body = { runId: options.runId ?? "" };
      else {
        if (!options.file) throw new Error("A request file is required");
        const file = realpathSync(resolve(repositoryRoot, options.file));
        const relation = relative(repositoryRoot, file);
        if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw new Error("Request file must be inside the current repository");
        if (statSync(file).size > 40 * 1024) throw new Error("Request file exceeds 40 KiB");
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request file must contain an object");
        body = value as Record<string, unknown>;
      }
      const status = await requestManagedRun(repositoryRoot, options.subcommand, body);
      process.stdout.write(`${JSON.stringify({ ok: true, status }, null, 2)}\n`);
      return 0;
    }
    if (isAttachedTaskAction(options.subcommand)) {
      let body: Record<string, unknown>;
      if (isAttachedTaskRead(options.subcommand)) body = { taskId: options.taskId ?? "" };
      else {
        if (!options.file) throw new Error("A request file is required");
        const file = realpathSync(resolve(repositoryRoot, options.file));
        const relation = relative(repositoryRoot, file);
        if (!relation || relation.startsWith("..") || isAbsolute(relation)) throw new Error("Request file must be inside the current repository");
        if (statSync(file).size > 40 * 1024) throw new Error("Request file exceeds 40 KiB");
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request file must contain an object");
        body = value as Record<string, unknown>;
      }
      const status = await requestAttachedTask(repositoryRoot, options.subcommand, body);
      process.stdout.write(`${JSON.stringify({ ok: true, status }, null, 2)}\n`);
      return 0;
    }
    if (options.subcommand === "serve") {
      const owner = await serveLocalTasks(repositoryRoot);
      process.stdout.write(options.json ? `${JSON.stringify({ ok: true, repositoryRoot: owner.repositoryRoot, port: owner.port, pid: process.pid })}\n` :
        `Agent Fabric owner running for ${owner.repositoryRoot} on local port ${owner.port}. Press Ctrl+C to stop.\n`);
      try {
        await new Promise<void>((resolve) => {
          process.once("SIGINT", resolve);
          process.once("SIGTERM", resolve);
        });
      } finally {
        await owner.close();
      }
      return 0;
    }
    if (options.subcommand === "change-propose" || options.subcommand === "change-status" ||
        options.subcommand === "change-review" || options.subcommand === "change-evidence") {
      let request: unknown;
      if (options.subcommand === "change-propose") {
        if (!options.file) throw new Error("A change request file is required");
        const file = realpathSync(resolve(repositoryRoot, options.file));
        const relation = relative(repositoryRoot, file);
        if (!relation || relation.startsWith("..") || isAbsolute(relation)) {
          throw new Error("Change request file must be inside the current repository");
        }
        if (statSync(file).size > 32 * 1024) throw new Error("Change request file exceeds byte limit");
        request = JSON.parse(readFileSync(file, "utf8")) as unknown;
      }
      changeService = await LocalChangeReviewService.open(repositoryRoot);
      const changeId = options.taskId ?? "";
      const status = options.subcommand === "change-propose"
        ? await changeService.propose(request as Parameters<LocalChangeReviewService["propose"]>[0])
        : options.subcommand === "change-status"
          ? await changeService.status(changeId)
          : options.subcommand === "change-evidence"
            ? await changeService.evidence(changeId)
            : await changeService.review(changeId);
      process.stdout.write(`${JSON.stringify({ ok: true, status }, null, 2)}\n`);
      return 0;
    }
    let proposal: unknown;
    if (options.subcommand === "propose" || options.subcommand === "memory-add" || options.subcommand === "memory-list") {
      if (!options.file) throw new Error("A request file is required");
      const file = realpathSync(resolve(repositoryRoot, options.file));
      const relation = relative(repositoryRoot, file);
      if (options.subcommand === "propose" && (!relation || relation.startsWith("..") || isAbsolute(relation))) {
        throw new Error("Proposal file must be inside the current repository");
      }
      if (statSync(file).size > (options.subcommand === "propose" ? 32 * 1024 : 4 * 1024)) throw new Error("Request file exceeds byte limit");
      proposal = JSON.parse(readFileSync(file, "utf8")) as unknown;
    }
    if (options.subcommand.startsWith("memory-")) {
      const action = options.subcommand as LocalMemoryAction;
      const body = action === "memory-delete" ? { id: options.taskId ?? "" } : proposal as Record<string, unknown>;
      const remote = await requestLocalMemory(repositoryRoot, action, body);
      if (remote === null) {
        service = await LocalTaskService.open(repositoryRoot);
      }
      const memory = remote ?? (action === "memory-add" ? service!.rememberMemory(body)
        : action === "memory-list" ? service!.listMemory(body)
          : { deleted: service!.forgetMemory(body.id) });
      process.stdout.write(options.json ? `${JSON.stringify({ ok: true, memory }, null, 2)}\n` :
        `${JSON.stringify(memory, null, 2)}\n`);
      return 0;
    }
    const action = options.subcommand as LocalTaskAction;
    const body = action === "propose" ? { proposal } : { taskId: options.taskId ?? "" };
    const remote = await requestLocalTask(repositoryRoot, action, body);
    if (remote) {
      process.stdout.write(options.json ? `${JSON.stringify({ ok: true, status: remote }, null, 2)}\n` :
        `${remote.taskId}: ${remote.state}; execution ${remote.canStart ? "available" : "not available"}\n`);
      return 0;
    }
    try { service = await LocalTaskService.open(repositoryRoot); }
    catch (error) {
      if (options.subcommand === "cancel") {
        throw new Error("Cannot reach the active local task owner. Start forge fabric serve before run to cancel an in-flight model call", { cause: error });
      }
      throw error;
    }
    if (options.subcommand === "cancel" &&
        (await service.status(options.taskId ?? "")).state === "model_uncertain") {
      throw new Error("An in-flight model call can only be cancelled through its running forge fabric serve owner");
    }
    const status = options.subcommand === "propose"
      ? await service.propose(proposal)
      : options.subcommand === "evidence"
        ? await service.evidence(options.taskId ?? "")
      : options.subcommand === "review"
        ? await service.review(options.taskId ?? "")
        : options.subcommand === "run"
          ? await service.run(options.taskId ?? "")
          : options.subcommand === "cancel"
            ? await service.cancel(options.taskId ?? "")
          : options.subcommand === "reconcile"
            ? await service.reconcile(options.taskId ?? "")
          : options.subcommand === "verify"
            ? await service.verify(options.taskId ?? "")
          : options.subcommand === "recover-verification"
            ? await service.recoverVerification(options.taskId ?? "")
          : options.subcommand === "review-result"
            ? await service.reviewResult(options.taskId ?? "")
          : await service.status(options.taskId ?? "");
    process.stdout.write(options.json ? `${JSON.stringify({ ok: true, status }, null, 2)}\n` :
      `${status.taskId}: ${status.state}; execution ${status.canStart ? "available" : "not available"}\n`);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stdout.write(options.json ? `${JSON.stringify({ ok: false, error: message }, null, 2)}\n` : `error: ${message}\n`);
    return 1;
  } finally {
    await service?.close();
    await changeService?.close();
  }
}
