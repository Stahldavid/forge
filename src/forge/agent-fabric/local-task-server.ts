import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname } from "node:path";
import { AgentFabricError, isAgentFabricError } from "./errors.ts";
import { LocalTaskService, type LocalTaskStatus } from "./local-task-service.ts";
import type { LocalMemoryEntry } from "./local-intelligence.ts";
import { localFabricPath } from "./local-paths.ts";

const MAX_REQUEST_BYTES = 40 * 1024;
const ENDPOINT_FILENAME = "owner-endpoint.json";

export type LocalTaskAction = "propose" | "status" | "evidence" | "review" | "run" | "reconcile" | "verify" | "review-result";
export type LocalMemoryAction = "memory-add" | "memory-list" | "memory-delete";
export type LocalMemoryResult = LocalMemoryEntry | readonly LocalMemoryEntry[] | { deleted: boolean };

interface OwnerEndpoint {
  schemaVersion: 1;
  repositoryRoot: string;
  pid: number;
  port: number;
  token: string;
}

function endpointPath(repositoryRoot: string): string {
  return localFabricPath(repositoryRoot, ENDPOINT_FILENAME);
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readEndpoint(repositoryRoot: string): OwnerEndpoint | null {
  const path = endpointPath(repositoryRoot);
  if (!existsSync(path)) return null;
  if (lstatSync(path).isSymbolicLink()) {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner endpoint is a symbolic link");
  }
  const bytes = readFileSync(path);
  if (bytes.length > 2_048) throw new AgentFabricError("AF_INVALID_STATE", "Local owner endpoint is oversized");
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner endpoint is invalid JSON");
  }
  const item = value as Partial<OwnerEndpoint>;
  if (!item || item.schemaVersion !== 1 || item.repositoryRoot !== repositoryRoot ||
      !Number.isSafeInteger(item.pid) || (item.pid ?? 0) <= 0 ||
      !Number.isSafeInteger(item.port) || (item.port ?? 0) < 1 || (item.port ?? 0) > 65535 ||
      typeof item.token !== "string" || !/^[0-9a-f]{64}$/u.test(item.token)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner endpoint is inconsistent");
  }
  if (!processIsAlive(item.pid!)) {
    // A killed owner cannot hold PGlite. Remove only the exact endpoint bytes
    // read above; a replacement means another owner is starting.
    if (readFileSync(path).equals(bytes)) unlinkSync(path);
    return null;
  }
  return item as OwnerEndpoint;
}

function authorized(request: IncomingMessage, endpoint: OwnerEndpoint): boolean {
  const supplied = request.headers.authorization;
  const expected = `Bearer ${endpoint.token}`;
  return request.headers.origin === undefined &&
    request.headers.host === `127.0.0.1:${endpoint.port}` &&
    typeof supplied === "string" && supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner request must be JSON");
  }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += part.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new AgentFabricError("AF_INVALID_STATE", "Local owner request exceeds 40 KiB");
    }
    chunks.push(part);
  }
  let value: unknown;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner request is invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner request is not an object");
  }
  return value as Record<string, unknown>;
}

async function dispatch(service: LocalTaskService, action: LocalTaskAction, request: Record<string, unknown>): Promise<LocalTaskStatus> {
  const keys = Object.keys(request).sort().join(",");
  if (action === "propose") {
    if (keys !== "proposal") throw new AgentFabricError("AF_INVALID_STATE", "Proposal request has unexpected fields");
    return service.propose(request.proposal);
  }
  if (keys !== "taskId" || typeof request.taskId !== "string") {
    throw new AgentFabricError("AF_INVALID_STATE", "Task request requires only taskId");
  }
  if (action === "status") return service.status(request.taskId);
  if (action === "evidence") return service.evidence(request.taskId);
  if (action === "review") return service.review(request.taskId);
  if (action === "run") return service.run(request.taskId);
  if (action === "reconcile") return service.reconcile(request.taskId);
  if (action === "verify") return service.verify(request.taskId);
  return service.reviewResult(request.taskId);
}

function dispatchMemory(service: LocalTaskService, action: LocalMemoryAction, request: Record<string, unknown>): LocalMemoryResult {
  if (action === "memory-add") return service.rememberMemory(request);
  if (action === "memory-list") return service.listMemory(request);
  if (Object.keys(request).join(",") !== "id") {
    throw new AgentFabricError("AF_INVALID_STATE", "Memory deletion requires only id");
  }
  return { deleted: service.forgetMemory(request.id) };
}

export interface LocalTaskOwnerServer {
  repositoryRoot: string;
  port: number;
  close(): Promise<void>;
}

/** One PGlite owner shared by CLI clients and the read/proposal MCP adapter. */
export async function serveLocalTasks(
  repositoryRoot: string,
  suppliedService?: LocalTaskService,
): Promise<LocalTaskOwnerServer> {
  const service = suppliedService ?? await LocalTaskService.open(repositoryRoot);
  const root = service.repositoryRoot;
  if (root !== realpathSync(repositoryRoot)) {
    if (!suppliedService) await service.close();
    throw new AgentFabricError("AF_INVALID_STATE", "Local owner service belongs to another repository");
  }
  const path = endpointPath(root);
  let listener: ReturnType<typeof createServer> | undefined;
  let published: OwnerEndpoint | undefined;
  try {
    if (readEndpoint(root)) {
      throw new AgentFabricError("AF_CONFLICT", "A local Agent Fabric owner is already running");
    }
    const token = randomBytes(32).toString("hex");
    listener = createServer((request, response: ServerResponse) => {
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      if (!published || !authorized(request, published)) {
        response.writeHead(403).end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      const action = request.url?.slice("/v1/".length) as LocalTaskAction | LocalMemoryAction;
      if (request.method !== "POST" || !request.url?.startsWith("/v1/") ||
          !["propose", "status", "evidence", "review", "run", "reconcile", "verify", "review-result", "memory-add", "memory-list", "memory-delete"].includes(action)) {
        response.writeHead(404).end(JSON.stringify({ ok: false, error: "unknown_action" }));
        return;
      }
      void readBody(request).then(async (body) => {
        if (action.startsWith("memory-")) return { memory: dispatchMemory(service, action as LocalMemoryAction, body) };
        return { status: await dispatch(service, action as LocalTaskAction, body) };
      }).then((result) => {
        if (!response.destroyed) response.writeHead(200).end(JSON.stringify({ ok: true, ...result }));
      }).catch((error: unknown) => {
        if (!response.destroyed) response.writeHead(isAgentFabricError(error) ? 400 : 500).end(JSON.stringify({
          ok: false, code: isAgentFabricError(error) ? error.code : "AF_INVALID_STATE",
          error: error instanceof Error ? error.message : "Local owner request failed",
        }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      listener!.once("error", reject);
      listener!.listen(0, "127.0.0.1", resolve);
    });
    const port = (listener.address() as AddressInfo).port;
    published = { schemaVersion: 1, repositoryRoot: root, pid: process.pid, port, token };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(published), { flag: "wx", mode: 0o600 });
    let closed = false;
    return {
      repositoryRoot: root, port,
      async close() {
        if (closed) return;
        closed = true;
        await new Promise<void>((resolve) => listener!.close(() => resolve()));
        if (existsSync(path) && readFileSync(path, "utf8") === JSON.stringify(published)) unlinkSync(path);
        if (!suppliedService) await service.close();
      },
    };
  } catch (error) {
    if (listener?.listening) await new Promise<void>((resolve) => listener!.close(() => resolve()));
    if (!suppliedService) await service.close();
    throw error;
  }
}

export async function requestLocalMemory(repositoryRoot: string, action: LocalMemoryAction,
  body: Record<string, unknown>): Promise<LocalMemoryResult | null> {
  const endpoint = readEndpoint(repositoryRoot);
  if (!endpoint) return null;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${action}`, {
      method: "POST", headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "manual", signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AgentFabricError("AF_INVALID_STATE", "Local Agent Fabric owner is unreachable; restart it before retrying");
  }
  if (response.status >= 300) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new AgentFabricError("AF_INVALID_STATE", result.error ?? "Local memory request failed");
  }
  const result = await response.json() as { ok?: boolean; memory?: LocalMemoryResult };
  if (!result.ok || result.memory === undefined) throw new AgentFabricError("AF_INVALID_STATE", "Local owner returned no memory result");
  return result.memory;
}

export async function requestLocalTask(
  repositoryRoot: string,
  action: LocalTaskAction,
  body: Record<string, unknown>,
): Promise<LocalTaskStatus | null> {
  const endpoint = readEndpoint(repositoryRoot);
  if (!endpoint) return null;
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${endpoint.port}/v1/${action}`, {
      method: "POST", headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body), redirect: "manual",
      signal: AbortSignal.timeout(action === "run" ? 130_000 : action === "verify" ? 250_000 :
        action === "review" || action === "review-result" ? 310_000 : 10_000),
    });
  } catch {
    throw new AgentFabricError("AF_INVALID_STATE", "Local Agent Fabric owner is unreachable; restart it before retrying");
  }
  if (response.status >= 300) {
    const result = await response.json().catch(() => ({})) as { code?: string; error?: string };
    throw new AgentFabricError("AF_INVALID_STATE", result.error ?? "Local owner request failed");
  }
  const result = await response.json() as { ok?: boolean; status?: LocalTaskStatus };
  if (!result.ok || !result.status) throw new AgentFabricError("AF_INVALID_STATE", "Local owner returned no task status");
  return result.status;
}
