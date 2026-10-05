import { existsSync, readFileSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";
import { DeltaStore } from "../delta/store.ts";
import { ingestEnvelope, runAgentMemoryCommand } from "./bridge.ts";
import { normalizeAgentEvent } from "./normalize.ts";
import { MANAGED_RUN_ACTIONS, requestManagedRun, ATTACHED_TASK_ACTIONS, isAttachedTaskRead, requestAttachedTask, requestLocalTask } from "../agent-fabric/local-task-server.ts";
import { LocalChangeReviewService } from "../agent-fabric/local-change-review-service.ts";
import { CODEX_EVENTS, CODEX_HOOK_RUNNER_RELATIVE, CODEX_MCP_HOOK_TOOL } from "./sources/codex.ts";
import { listFabricProjects, registerFabricProject, resolveFabricProject } from "../agent-fabric/project-registry.ts";
import { runRepositoryCommand } from "../cli/repository.ts";


const managedCommon = { runId: { type: "string" }, requestId: { type: "string" }, expectedVersion: { type: "integer", minimum: 1 } };
const managedStrings = { type: "array", items: { type: "string" }, uniqueItems: true };
const managedNodeSchema = { type: "object", properties: {
  nodeId: { type: "string" }, kind: { type: "string", enum: ["activity", "verification", "join", "decision"] },
  dependsOn: managedStrings, inputDigest: { type: "string", pattern: "^(?:sha256:)?[a-f0-9]{64}$" }, required: { type: "boolean" },
  inputRefs: managedStrings, contextRefs: managedStrings, decisionId: { type: "string" },
  outputContract: { type: "object", properties: { requiredEvidenceKinds: managedStrings }, required: ["requiredEvidenceKinds"], additionalProperties: false },
}, required: ["nodeId", "kind", "dependsOn", "inputDigest", "required"], additionalProperties: false };
const managedExecutorSchema = { type: "object", properties: {
  nodeId: { type: "string" }, type: { type: "string", enum: ["codex", "command"] },
  role: { type: "string", enum: ["implementer", "reviewer", "investigator", "decision"] },
  prompt: { type: "string", maxLength: 12000 }, writeScope: { ...managedStrings, minItems: 1, maxItems: 100 },
  model: { type: "string", maxLength: 100 }, argv: { type: "array", minItems: 1, maxItems: 40, items: { type: "string", maxLength: 4096 } },
  timeoutMs: { type: "integer", minimum: 100, maximum: 1800000 },
}, required: ["nodeId", "type"], additionalProperties: false };
const managedNodes = { type: "array", minItems: 1, maxItems: 32, items: managedNodeSchema };
const managedExecutors = { type: "array", minItems: 1, maxItems: 32, items: managedExecutorSchema };
const managedEnvironmentSchema = { type: "object", properties: {
  mode: { type: "string", enum: ["auto", "none"] }, ignoreScripts: { type: "boolean" },
  registry: { type: "string", maxLength: 2048, format: "uri", pattern: "^https://" },
  timeoutMs: { type: "integer", minimum: 100, maximum: 1800000 },
}, additionalProperties: false };
function managedRunSchema(action: typeof MANAGED_RUN_ACTIONS[number]): Record<string, unknown> {
  if (action === "run-status") return { type: "object", properties: { runId: { type: "string" } }, required: ["runId"], additionalProperties: false };
  const properties = action === "run-start" ? {
    requestId: { type: "string" }, goal: { type: "string" }, scope: { ...managedStrings, minItems: 1, maxItems: 100 },
    workflow: { type: "object", properties: { workflowId: { type: "string" }, nodes: managedNodes,
      limits: { type: "object", properties: { maxConcurrency: { type: "integer", minimum: 1, maximum: 4 },
        maxAttempts: { type: "integer", minimum: 1 }, maxRevisions: { type: "integer", minimum: 1, maximum: 20 },
        maxTotalAttempts: { type: "integer", minimum: 1, maximum: 100 } }, additionalProperties: false } },
      required: ["workflowId", "nodes"], additionalProperties: false },
    executors: managedExecutors, publish: { type: "boolean" }, environment: managedEnvironmentSchema,
  } : action === "run-wait" ? { runId: { type: "string" }, cursor: { type: "integer", minimum: 0 }, waitMs: { type: "integer", minimum: 0, maximum: 30000 } }
    : { ...managedCommon, ...(action === "run-steer" ? { instruction: { type: "string" } }
      : action === "run-resume" ? { expectedRevision: { type: "integer", minimum: 1 }, nodes: managedNodes,
          executors: managedExecutors, environment: managedEnvironmentSchema, reason: { type: "string" }, evidenceRefs: managedStrings }
      : action === "run-reconcile" ? { attemptId: { type: "string" }, resolution: { type: "string", enum: ["failed"] }, reason: { type: "string" }, publication: { type: "string", enum: ["confirm", "retry"] } } : {}) };
  const required = action === "run-start" ? ["requestId", "goal", "scope", "workflow", "executors"]
    : action === "run-wait" ? ["runId"] : ["runId", "requestId", "expectedVersion", ...(action === "run-steer" ? ["instruction"] : [])];
  return { type: "object", properties: { request: { type: "object", properties, required, additionalProperties: false,
    ...(action === "run-reconcile" ? { anyOf: [{ required: ["attemptId", "resolution", "reason"] }, { required: ["publication"] }] } : {}) } },
    required: ["request"], additionalProperties: false };
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

export interface FabricMcpOptions { registryDirectory?: string }

function projectAwareSchema(schema: Record<string, unknown>): Record<string, unknown> {
  return { ...schema, properties: { ...(schema.properties as Record<string, unknown>),
    projectId: { type: "string", minLength: 1, description: "Registered project identifier. Omit to use the MCP server's original workspace." } } };
}

export async function handleMcpRequest(workspaceRoot: string, request: JsonRpcRequest, options: FabricMcpOptions = {}): Promise<Record<string, unknown> | null> {
  if (request.method.startsWith("notifications/")) {
    return null;
  }
  try {
    if (request.method === "initialize") {
      return response(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "forgeos-agent-memory", version: "0.1.0" },
      });
    }
    if (request.method === "tools/list") {
      return response(request.id, {
        tools: [
          { name: "fabric_repository_discover", description: "Propose a repository analysis manifest without writing files or executing project tools.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
          { name: "fabric_repository_analyze", description: "Analyze repository sources statically. write=true explicitly saves local map artifacts; never starts models, builds or containers.", inputSchema: { type: "object", properties: { write: { type: "boolean", default: false } }, additionalProperties: false } },
          { name: "fabric_repository_context", description: "Read bounded snapshot-bound repository maps and evidence. Requires previously saved analysis.", inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 2000 }, snapshotId: { type: "string", maxLength: 2000 }, limit: { type: "integer", minimum: 1, maximum: 100 }, maxChars: { type: "integer", minimum: 2048, maximum: 50000 }, cursor: { type: "string", maxLength: 1000 } }, additionalProperties: false } },
          { name: "fabric_project_register", description: "Explicitly register a Git project root for isolated Agent Fabric routing. Does not start workers.",
            inputSchema: { type: "object", properties: { root: { type: "string", minLength: 1, description: "Absolute path to the Git project or one of its subdirectories." }, id: { type: "string", minLength: 1 } }, required: ["root"], additionalProperties: false } },
          { name: "fabric_project_list", description: "List registered Agent Fabric projects and their canonical roots.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false } },
          { name: "fabric_project_doctor", description: "Diagnose the selected project's runtime and owner without starting workers.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false } },
          { name: "fabric_owner_start", description: "Ensure the selected project's isolated owner is running. Does not start a workflow or model.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false } },
          ...MANAGED_RUN_ACTIONS.map((action) => ({
            name: `fabric_${action.replaceAll("-", "_")}`,
            description: action === "run-start"
              ? "Start managed workflow worker processes through the owner. Codex workers may consume credits; command workers execute their explicit argv."
              : action === "run-status" || action === "run-wait"
                ? "Read managed workflow execution status or wait for durable events with a maximum 30-second wait."
                : "Control managed execution through its single owner: steer, pause, resume, cancel or reconcile recorded work.",
            inputSchema: managedRunSchema(action),
          })),
          ...ATTACHED_TASK_ACTIONS.map((action) => ({
            name: `fabric_${action.replaceAll("-", "_")}`,
            description: isAttachedTaskRead(action)
              ? "Read accompanied Codex task or caller-driven workflow state from its running owner."
              : "Record accompanied task or caller-driven workflow data. Does not dispatch agents, execute commands, approve effects or start a model.",
            inputSchema: isAttachedTaskRead(action)
              ? { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"], additionalProperties: false }
              : { type: "object", properties: { request: { type: "object" } }, required: ["request"], additionalProperties: false },
          })),
          {
            name: "fabric_capabilities",
            description: "Read the current Agent Fabric coding-task capability boundary.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: "fabric_propose",
            description: "Submit an untrusted local coding task proposal to the running Agent Fabric owner. This does not approve or run it.",
            inputSchema: { type: "object", properties: { proposal: { type: "object" } },
              required: ["proposal"], additionalProperties: false },
          },
          {
            name: "fabric_status",
            description: "Read status and bounded evidence for a local coding task from the running Agent Fabric owner.",
            inputSchema: { type: "object", properties: { taskId: { type: "string" } },
              required: ["taskId"], additionalProperties: false },
          },
          {
            name: "fabric_evidence",
            description: "Read digest-bound task provenance without raw model output or diff content.",
            inputSchema: { type: "object", properties: { taskId: { type: "string" } },
              required: ["taskId"], additionalProperties: false },
          },
          {
            name: "fabric_change_propose",
            description: "Register a change request for independent review. The exact diff is pinned when the owner runs the reviewer; this tool does not start a paid reviewer or approve the change.",
            inputSchema: { type: "object", properties: { request: {
              type: "object",
              properties: { objective: { type: "string" }, acceptanceCriteria: { type: "array", items: { type: "string" } },
                implementer: { type: "string" } },
              required: ["objective", "acceptanceCriteria", "implementer"], additionalProperties: false,
            } }, required: ["request"], additionalProperties: false },
          },
          {
            name: "fabric_change_status",
            description: "Read the current state of a pinned change review without starting a reviewer.",
            inputSchema: { type: "object", properties: { changeId: { type: "string" } },
              required: ["changeId"], additionalProperties: false },
          },
          {
            name: "fabric_change_evidence",
            description: "Read exact-diff and review evidence for a pinned change without starting a reviewer.",
            inputSchema: { type: "object", properties: { changeId: { type: "string" } },
              required: ["changeId"], additionalProperties: false },
          },
          {
            name: CODEX_MCP_HOOK_TOOL,
            description: "Receive a Codex lifecycle hook and enqueue its redacted metadata. Called by reviewed Codex hooks; agents should not call this tool directly.",
            inputSchema: {
              type: "object",
              properties: { eventName: { type: "string", enum: CODEX_EVENTS }, payload: { type: "object" } },
              required: ["eventName", "payload"],
              additionalProperties: false,
            },
          },
          {
            name: "agent_context",
            description: "Read the ForgeOS Agent Memory context pack for the current work or a runtime entry.",
            inputSchema: {
              type: "object",
              properties: { entry: { type: "string" } },
              additionalProperties: false,
            },
          },
          {
            name: "agent_memory",
            description: "List recent redacted agent memory events.",
            inputSchema: {
              type: "object",
              properties: { target: { type: "string" }, limit: { type: "number" } },
              additionalProperties: false,
            },
          },
          {
            name: "timeline",
            description: "Read the semantic timeline for an entry, file, policy, service, tool, or agent.",
            inputSchema: {
              type: "object",
              properties: { target: { type: "string" }, limit: { type: "number" } },
              required: ["target"],
              additionalProperties: false,
            },
          },
          {
            name: "inspect_all",
            description: "Read the generated ForgeOS machine contract artifacts that are safe for agents.",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ].map((tool) => tool.name.startsWith("fabric_") && tool.name !== "fabric_project_register" && tool.name !== "fabric_project_list"
          ? { ...tool, inputSchema: projectAwareSchema(tool.inputSchema) } : tool),
      });
    }
    if (request.method === "tools/call") {
      const params = request.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
        ? params.arguments as Record<string, unknown>
        : {};
      let toolRoot = workspaceRoot;
      const toolArgs = { ...args };
      if (name.startsWith("fabric_") && name !== "fabric_project_register" && name !== "fabric_project_list" && "projectId" in toolArgs) {
        if (typeof toolArgs.projectId !== "string" || !toolArgs.projectId.trim()) throw new Error("projectId must be a non-empty registered project identifier");
        toolRoot = await resolveFabricProject(toolArgs.projectId, options);
        delete toolArgs.projectId;
      }
      const toolResult = await runTool(toolRoot, name, toolArgs, options);
      const result = typeof args.projectId === "string" && name.startsWith("fabric_") && toolResult && typeof toolResult === "object"
        ? { ...toolResult, projectContext: { id: args.projectId, root: toolRoot } } : toolResult;
      if (name !== CODEX_MCP_HOOK_TOOL && !name.startsWith("fabric_repository_")) {
        await logMcpToolCall(toolRoot, name, args, "completed").catch(() => undefined);
      }
      return response(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        ...(result && typeof result === "object" && "ok" in result && result.ok === false ? { isError: true } : {}),
      });
    }
    return response(request.id, null, { code: -32601, message: `unknown MCP method: ${request.method}` });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return response(request.id, null, { code: -32000, message });
  }
}

export async function runMcpServe(workspaceRoot: string): Promise<number> {
  let buffer: Buffer = Buffer.alloc(0);
  let sawFramedMessage = false;
  for await (const chunk of process.stdin) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))]);
    const parsed = parseMcpFrames(buffer);
    buffer = parsed.remainder;
    if (parsed.requests.length > 0) {
      sawFramedMessage = true;
    }
    for (const request of parsed.requests) {
      const result = await handleMcpRequest(workspaceRoot, request);
      if (result) {
        writeMcpMessage(result);
      }
    }
  }
  const leftover = buffer.toString("utf8").trim();
  if (!sawFramedMessage && leftover.startsWith("{")) {
    const result = await handleMcpRequest(workspaceRoot, JSON.parse(leftover) as JsonRpcRequest);
    if (result) {
      writeMcpMessage(result);
    }
  }
  return 0;
}

async function runTool(workspaceRoot: string, name: string, args: Record<string, unknown>, options: FabricMcpOptions): Promise<unknown> {
  if (name.startsWith("fabric_repository_")) {
    const action = name.slice("fabric_repository_".length);
    if (!["discover", "analyze", "context"].includes(action)) throw new Error("Unknown repository operation");
    const allowed = action === "context" ? ["query", "snapshotId", "limit", "maxChars", "cursor"] : action === "analyze" ? ["write"] : [];
    if (Object.keys(args).some(key => !allowed.includes(key))) throw new Error("Unknown repository argument");
    for (const [key, max] of [["query", 2000], ["snapshotId", 2000], ["cursor", 1000]] as const) if (key in args && (typeof args[key] !== "string" || (args[key] as string).length > max)) throw new Error(`Invalid ${key}`);
    for (const [key, min, max] of [["limit", 1, 100], ["maxChars", 2048, 50000]] as const) if (key in args && (!Number.isSafeInteger(args[key]) || (args[key] as number) < min || (args[key] as number) > max)) throw new Error(`Invalid ${key}`);
    if ("write" in args && typeof args.write !== "boolean") throw new Error("write must be boolean");
    const result = await runRepositoryCommand({ action: action as "discover" | "analyze" | "context", cwd: workspaceRoot, root: workspaceRoot,
      json: true, write: args.write === true, query: args.query as string | undefined, snapshotId: args.snapshotId as string | undefined,
      limit: args.limit as number | undefined, maxChars: args.maxChars as number | undefined, cursor: args.cursor as string | undefined });
    const { snapshot, ...compact } = result;
    if (snapshot) {
      const coverage = (snapshot as import("../repository-analysis/types.ts").RepositorySnapshot).coverage;
      return { ...compact, coverage: { ...coverage, diagnostics: coverage.diagnostics.slice(0, 20), ignoredPaths: coverage.ignoredPaths.slice(0, 20), limitations: coverage.limitations.slice(0, 20),
        omitted: { diagnostics: Math.max(0, coverage.diagnostics.length - 20), ignoredPaths: Math.max(0, coverage.ignoredPaths.length - 20), limitations: Math.max(0, coverage.limitations.length - 20) } },
        nextAction: args.write === true ? "fabric_repository_context" : "fabric_repository_analyze with write=true explicitly saves this analysis for later queries" };
    }
    return compact;
  }
  if (name === "fabric_project_register") {
    if (Object.keys(args).some(key => key !== "root" && key !== "id") || typeof args.root !== "string" || !isAbsolute(args.root) ||
        ("id" in args && (typeof args.id !== "string" || !args.id.trim()))) throw new Error("fabric_project_register requires an absolute root and optional id");
    return { ok: true, project: await registerFabricProject(args.root, { ...options, ...(typeof args.id === "string" ? { id: args.id } : {}) }) };
  }
  if (name === "fabric_project_list") {
    if (Object.keys(args).length) throw new Error("fabric_project_list accepts no arguments");
    return { ok: true, projects: await listFabricProjects(options) };
  }
  if (name === "fabric_project_doctor" || name === "fabric_owner_start") {
    if (Object.keys(args).length) throw new Error(`${name} accepts only optional projectId`);
    const { ensureFabricOwner, fabricProjectDoctor } = await import("../agent-fabric/project-runtime.ts");
    if (name === "fabric_project_doctor") {
      const diagnostics = await fabricProjectDoctor(workspaceRoot);
      return { ok: diagnostics.ok, diagnostics };
    }
    return { ok: true, owner: await ensureFabricOwner(workspaceRoot) };
  }
  const managedAction = MANAGED_RUN_ACTIONS.find((action) => name === `fabric_${action.replaceAll("-", "_")}`);
  if (managedAction) {
    const read = managedAction === "run-status";
    if (Object.keys(args).join(",") !== (read ? "runId" : "request") ||
        (read ? typeof args.runId !== "string" : !args.request || typeof args.request !== "object" || Array.isArray(args.request))) {
      throw new Error(`${name} requires only ${read ? "runId" : "an object request"}`);
    }
    return { ok: true, status: await requestManagedRun(realpathSync(workspaceRoot), managedAction,
      read ? args : args.request as Record<string, unknown>) };
  }
  const attachedAction = ATTACHED_TASK_ACTIONS.find((action) => name === `fabric_${action.replaceAll("-", "_")}`);
  if (attachedAction) {
    const read = isAttachedTaskRead(attachedAction);
    if (Object.keys(args).join(",") !== (read ? "taskId" : "request") ||
        (read ? typeof args.taskId !== "string" : !args.request || typeof args.request !== "object" || Array.isArray(args.request))) {
      throw new Error(`${name} requires only ${read ? "taskId" : "an object request"}`);
    }
    return { ok: true, status: await requestAttachedTask(realpathSync(workspaceRoot), attachedAction,
      read ? args : args.request as Record<string, unknown>) };
  }
  if (name === CODEX_MCP_HOOK_TOOL) {
    if (Object.keys(args).sort().join(",") !== "eventName,payload" ||
        typeof args.eventName !== "string" || !CODEX_EVENTS.includes(args.eventName) ||
        !args.payload || typeof args.payload !== "object" || Array.isArray(args.payload)) {
      throw new Error("agent_hook_ingest requires a supported eventName and object payload");
    }
    const hookCwd = (args.payload as Record<string, unknown>).cwd;
    if (typeof hookCwd !== "string") throw new Error("Codex hook cwd is required");
    const relativeCwd = relative(realpathSync(workspaceRoot), realpathSync(hookCwd));
    if (relativeCwd === ".." || relativeCwd.startsWith(`..${sep}`) || isAbsolute(relativeCwd)) {
      throw new Error("Codex hook cwd is outside the MCP server workspace");
    }
    const payload: Record<string, unknown> = {
      ...(args.payload as Record<string, unknown>),
      hook_event_name: args.eventName,
      cwd: workspaceRoot,
      forgeMcpHook: true,
    };
    let serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
      const toolInput = payload.tool_input;
      if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
        const command = (toolInput as Record<string, unknown>).command;
        if (typeof command === "string") {
          payload.commandHash = createHash("sha256").update(command).digest("hex");
          const match = /^\s*(forge)\s+(status|changed|check|verify|run|agent|fabric|generate|inspect|test)\b/u.exec(command);
          payload.commandSummary = match ? match.slice(1).join(" ") : "[command redacted]";
        }
        delete payload.tool_input;
        serialized = JSON.stringify(payload);
      }
    }
    if (Buffer.byteLength(serialized, "utf8") > 256 * 1024) {
      throw new Error("Codex hook payload exceeds 256 KiB");
    }
    const runner = join(workspaceRoot, CODEX_HOOK_RUNNER_RELATIVE);
    if (!existsSync(runner)) throw new Error("Codex hook runner is not installed");
    await enqueueCodexHook(runner, workspaceRoot, args.eventName, serialized);
    return { ok: true, queued: true };
  }
  if (name === "fabric_capabilities") {
    if (Object.keys(args).length !== 0) throw new Error("fabric_capabilities accepts no arguments");
    return {
      ok: true,
      schemaVersion: 1,
      protocolKernel: "p0a_available",
      boundedModelAdapter: "p0b_a_available",
      codingTaskControl: "local_owner_service_required",
      projectRouting: { supported: true, registrationRequired: true, defaultWorkspace: realpathSync(workspaceRoot),
        ownerIsolation: "per_project", hooks: "server_workspace_only", tools: ["fabric_project_register", "fabric_project_list", "fabric_project_doctor", "fabric_owner_start"] },
      managedExecution: { supported: true, runningOwnerRequired: true, scheduler: "owner_managed",
        executors: ["codex", "command"], startDispatchesWork: true, boundedEventWaitMs: 30_000,
        codexMayConsumeCredits: true, controls: ["steer", "pause", "resume", "cancel", "reconcile"],
        environment: { automaticPreparation: true, isolatedDependencies: true, cacheReuse: "verified_copy", ignoreScriptsDefault: true },
        tools: MANAGED_RUN_ACTIONS.map((action) => `fabric_${action.replaceAll("-", "_")}`) },
      accompaniedTasks: { supported: true, runningOwnerRequired: true, nativeSessionAssociation: true,
        evidenceProvenance: "agent_reported", automaticDispatch: false, managedWorkers: false, workflowExecution: "caller_driven",
        tools: ATTACHED_TASK_ACTIONS.map((action) => `fabric_${action.replaceAll("-", "_")}`) },
      consequentialEffects: true,
      effectsByMode: { legacy: "owner_reviewed_local_pilot", accompanied: "caller_driven_records",
        managed: "process_execution_and_optional_local_publication" },
      mcpDispatch: { legacy: "proposal_only", accompanied: "caller_driven_records", managed: "run_start_dispatches_work" },
      ownerApproval: "legacy_local_popup_cli_only",
      cancellation: { legacy: "owner_cli_only_best_effort", managed: "fabric_run_cancel_best_effort" },
      taskMutationTools: ["fabric_propose",
        ...ATTACHED_TASK_ACTIONS.filter(action => !isAttachedTaskRead(action)).map(action => `fabric_${action.replaceAll("-", "_")}`),
        ...MANAGED_RUN_ACTIONS.filter(action => action !== "run-status" && action !== "run-wait").map(action => `fabric_${action.replaceAll("-", "_")}`)],
      taskReadTools: ["fabric_status", "fabric_evidence"],
      changeMutationTools: ["fabric_change_propose"],
      changeReadTools: ["fabric_change_status", "fabric_change_evidence"],
      changeReviewDispatch: "owner_cli_only",
      cli: "forge fabric capabilities --json",
    };
  }
  if (name === "fabric_propose" || name === "fabric_status" || name === "fabric_evidence") {
    const keys = Object.keys(args).sort().join(",");
    if (name === "fabric_propose" && keys !== "proposal") throw new Error("fabric_propose requires only proposal");
    if ((name === "fabric_status" || name === "fabric_evidence") &&
        (keys !== "taskId" || typeof args.taskId !== "string")) {
      throw new Error(`${name} requires only taskId`);
    }
    const status = await requestLocalTask(realpathSync(workspaceRoot),
      name === "fabric_propose" ? "propose" : name === "fabric_evidence" ? "evidence" : "status", args);
    if (!status) throw new Error("Agent Fabric local owner is not running; start forge fabric serve");
    if (name === "fabric_evidence") {
      return { ok: true, taskId: status.taskId, state: status.state, provenance: status.provenance };
    }
    return { ok: true, status };
  }
  if (name === "fabric_change_propose" || name === "fabric_change_status" || name === "fabric_change_evidence") {
    const keys = Object.keys(args).sort().join(",");
    if (name === "fabric_change_propose" &&
        (keys !== "request" || !args.request || typeof args.request !== "object" || Array.isArray(args.request))) {
      throw new Error("fabric_change_propose requires only request");
    }
    if (name !== "fabric_change_propose" &&
        (keys !== "changeId" || typeof args.changeId !== "string" || args.changeId.length === 0)) {
      throw new Error(`${name} requires only changeId`);
    }
    const service = await LocalChangeReviewService.open(realpathSync(workspaceRoot));
    try {
      const result = name === "fabric_change_propose"
        ? await service.propose(args.request as Parameters<LocalChangeReviewService["propose"]>[0])
        : name === "fabric_change_status"
          ? await service.status(args.changeId as string)
          : await service.evidence(args.changeId as string);
      return { ok: true, ...(name === "fabric_change_evidence" ? { evidence: result } : { status: result }) };
    } finally {
      await service.close();
    }
  }
  if (name === "agent_context") {
    return runAgentMemoryCommand({
      subcommand: "context",
      workspaceRoot,
      json: true,
      entry: typeof args.entry === "string" ? args.entry : undefined,
    });
  }
  if (name === "agent_memory") {
    return runAgentMemoryCommand({
      subcommand: "memory",
      workspaceRoot,
      json: true,
      entry: typeof args.target === "string" ? args.target : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
  }
  if (name === "timeline") {
    const target = typeof args.target === "string" ? args.target : undefined;
    if (!target) {
      throw new Error("timeline requires target");
    }
    const store = await DeltaStore.open(workspaceRoot, { access: "read" });
    try {
      return {
        ok: true,
        timeline: await store.semanticTimeline({
          target,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }),
      };
    } finally {
      await store.close();
    }
  }
  if (name === "inspect_all") {
    return readInspectAll(workspaceRoot);
  }
  throw new Error(`unknown ForgeOS MCP tool: ${name}`);
}

function enqueueCodexHook(runner: string, workspaceRoot: string, eventName: string, payload: string): Promise<void> {
  return new Promise((resolveEnqueue, rejectEnqueue) => {
    const child = spawn(process.execPath, [runner, eventName], {
      cwd: workspaceRoot,
      windowsHide: true,
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 2_000,
    });
    child.once("error", () => rejectEnqueue(new Error("Codex hook queue runner could not start")));
    child.once("close", (code) => code === 0
      ? resolveEnqueue()
      : rejectEnqueue(new Error("Codex hook queue runner failed")));
    child.stdin.on("error", () => undefined);
    child.stdin.end(payload);
  });
}

async function logMcpToolCall(workspaceRoot: string, toolName: string, args: Record<string, unknown>, status: string): Promise<void> {
  const envelope = normalizeAgentEvent({
    workspaceRoot,
    source: "generic",
    integration: "mcp",
    eventName: "tool.call",
    raw: {
      toolName,
      args,
      status,
      timestamp: new Date().toISOString(),
    },
  });
  await ingestEnvelope(workspaceRoot, envelope);
}

function readInspectAll(workspaceRoot: string): Record<string, unknown> {
  const generated = join(workspaceRoot, "src", "forge", "_generated");
  const read = (name: string) => {
    try {
      return JSON.parse(readFileSync(join(generated, name), "utf8")) as unknown;
    } catch {
      return null;
    }
  };
  return {
    ok: true,
    agentContract: read("agentContract.json"),
    agentTools: read("agentTools.json"),
    runtimeGraph: read("runtimeGraph.json"),
    policyRegistry: read("policyRegistry.json"),
  };
}

function response(id: JsonRpcRequest["id"], result: unknown, error?: Record<string, unknown>): Record<string, unknown> {
  return error ? { jsonrpc: "2.0", id: id ?? null, error } : { jsonrpc: "2.0", id: id ?? null, result };
}

function parseMcpFrames(raw: Buffer): { requests: JsonRpcRequest[]; remainder: Buffer } {
  const messages: JsonRpcRequest[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headerEnd === -1) {
      break;
    }
    const header = raw.subarray(cursor, headerEnd).toString("ascii");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      break;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (!Number.isSafeInteger(length) || length < 0 || length > 1024 * 1024) {
      throw new Error("Invalid MCP Content-Length");
    }
    if (raw.length - bodyStart < length) break;
    const body = raw.subarray(bodyStart, bodyStart + length).toString("utf8");
    messages.push(JSON.parse(body) as JsonRpcRequest);
    cursor = bodyStart + length;
  }
  return { requests: messages, remainder: raw.subarray(cursor) };
}

function writeMcpMessage(message: Record<string, unknown>): void {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}
