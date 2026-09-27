import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createPgliteAdapter } from "../runtime/db/pglite-adapter.ts";
import { digestCanonical, sha256Digest } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { LocalAdaptiveHarness, compileLocalAdaptiveRevision, type LocalAdaptiveProcessResult } from "./local-adaptive-harness.ts";
import { LocalControlStore } from "./local-control-store.ts";
import { LocalEvolutionService } from "./local-evolution-service.ts";
import { assertLocalAdaptiveInputs, LOCAL_ADAPTIVE_EXTENSION_KEY, parseLocalAdaptiveInputProfile } from "./local-evolution-profile.ts";
import { localFabricPath } from "./local-paths.ts";
import { replayControlState } from "./hardened-reducer.ts";
import type { EvolutionChannel } from "./local-evolution-registry.ts";
import type { Clock, Digest, GoalContract, OwnerAuthorization, OwnerAuthorizationVerifier } from "./types.ts";

const WORKERS = [{ resource: "workers", semantics: "capacity" as const, limit: 2 }];
const clock: Clock = { now: () => Date.now() };
const MAX_TEXT = 256;

export interface AdaptiveInput { inventory: string; constraints: string }
type Phase = "proposed" | "rejected" | "approved" | "running" | "succeeded" | "blocked" | "uncertain";
interface AdaptiveRecord {
  schemaVersion: 1;
  id: string;
  repositoryRoot: string;
  input: AdaptiveInput;
  inputDigest: Digest;
  profile?: { channel: EvolutionChannel; versionId: string };
  phase: Phase;
  createdAt: number;
  approvedAt?: number;
  approvalReceipt?: Digest;
  startedAt?: number;
  finishedAt?: number;
  result?: LocalAdaptiveProcessResult;
  failure?: string;
}
export interface AdaptiveStatus {
  id: string;
  phase: Phase;
  inputDigest: Digest;
  profile?: { channel: EvolutionChannel; versionId: string };
  result?: LocalAdaptiveProcessResult;
  failure?: string;
  journal: { events: number; childOutcomes: number; joinOutcome?: { status: string; resultDigest: Digest; reportDigest: Digest } };
}
type Approval = (view: { repositoryRoot: string; id: string; input: AdaptiveInput; digest: Digest;
  profile?: { channel: EvolutionChannel; versionId: string } }) => Promise<"approved" | "rejected">;

function validateInput(value: unknown): AdaptiveInput {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).sort().join(",") !== "constraints,inventory") {
    throw new AgentFabricError("AF_INVALID_STATE", "Expected exactly inventory and constraints text");
  }
  const input = value as Record<string, unknown>;
  for (const field of ["inventory", "constraints"] as const) {
    if (typeof input[field] !== "string" || input[field].length > MAX_TEXT ||
        Buffer.byteLength(input[field], "utf8") > MAX_TEXT) {
      throw new AgentFabricError("AF_INVALID_STATE", `${field} must be at most 256 UTF-8 bytes`);
    }
  }
  return { inventory: input.inventory as string, constraints: input.constraints as string };
}

function ids(id: string) {
  return { root: `adaptive:${id}`, authorization: `auth:${id}`, goal: `goal:${id}`,
    revision: `plan:${id}`, grant: `grant:${id}:coordinator` };
}

function readRecord(path: string): AdaptiveRecord {
  if (statSync(path).size > 16 * 1024) throw new AgentFabricError("AF_INVALID_STATE", "Adaptive record exceeds byte limit");
  const value = JSON.parse(readFileSync(path, "utf8")) as AdaptiveRecord;
  validateInput(value.input);
  if (value.schemaVersion !== 1 || !/^[a-f0-9]{32}$/u.test(value.id) ||
      digestCanonical(value.input, sha256Digest) !== value.inputDigest ||
      (value.profile && (typeof value.profile !== "object" ||
        (value.profile.channel !== "canary" && value.profile.channel !== "stable") ||
        !/^extension:sha256:[0-9a-f]{64}$/u.test(value.profile.versionId))) ||
      !["proposed", "rejected", "approved", "running", "succeeded", "blocked", "uncertain"].includes(value.phase)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Adaptive record failed validation");
  }
  return value;
}

function writeRecord(path: string, value: AdaptiveRecord): void {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  writeFileSync(temporary, JSON.stringify(value), { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, path);
}

function ownerVerifier(key: Buffer, approvals: Set<Digest>): OwnerAuthorizationVerifier {
  const evidence = (digest: Digest): Digest => `sha256:${createHmac("sha256", key)
    .update("forge-local-adaptive-owner/v1:").update(digest).digest("hex")}`;
  return {
    verify(_authorization, digest) {
      if (!approvals.delete(digest)) throw new AgentFabricError("AF_GRANT_REJECTED", "Owner approval is absent");
      return { verifierId: "forge-local-adaptive-popup/v1", authorizationDigest: digest, evidenceDigest: evidence(digest) };
    },
    verifyRecorded(authorization, record) {
      const digest = digestCanonical(authorization, sha256Digest);
      const expected = evidence(digest);
      return record.verifierId === "forge-local-adaptive-popup/v1" && record.authorizationDigest === digest &&
        typeof record.evidenceDigest === "string" && record.evidenceDigest.length === expected.length &&
        timingSafeEqual(Buffer.from(record.evidenceDigest), Buffer.from(expected));
    },
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

/** Visible browser decision bound to the exact two inputs and local repository. */
export async function requestAdaptiveApproval(view: Parameters<Approval>[0]): ReturnType<Approval> {
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let resolveDecision!: (decision: "approved" | "rejected") => void;
  let rejectDecision!: (error: Error) => void;
  const decision = new Promise<"approved" | "rejected">((resolve, reject) => {
    resolveDecision = resolve; rejectDecision = reject;
  });
  let decided = false;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (request.headers.host !== origin.slice(7)) return void response.writeHead(400).end();
    if (request.method === "GET" && request.url === `/${token}` && !decided) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      return void response.writeHead(200).end(`<!doctype html><html><meta charset="utf-8"><title>Forge adaptive approval</title><style>body{font:16px system-ui;max-width:700px;margin:4rem auto;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:1rem}button{padding:.7rem 1rem;margin-right:1rem}</style><h1>Approve fixed local data workers</h1><p>Two bounded Node processes will digest the text below. No model, shell task, network request, or repository edit is selected by these inputs.</p><p>Repository: ${escapeHtml(view.repositoryRoot)}</p><p>Run: ${escapeHtml(view.id)}</p><p>Selected data profile: ${escapeHtml(view.profile ? `${view.profile.channel} / ${view.profile.versionId}` : "none")}</p><h2>Inventory</h2><pre>${escapeHtml(view.input.inventory)}</pre><h2>Constraints</h2><pre>${escapeHtml(view.input.constraints)}</pre><p>Proposal digest: ${escapeHtml(view.digest)}</p><form method="post" action="/decision/${token}"><input type="hidden" name="digest" value="${escapeHtml(view.digest)}"><button name="decision" value="approved">Approve</button><button name="decision" value="rejected">Reject</button></form>`);
    }
    const sameOrigin = request.headers.origin === origin ||
      (request.headers.origin === "null" && request.headers["sec-fetch-site"] === "same-origin");
    if (request.method !== "POST" || request.url !== `/decision/${token}` || decided || !sameOrigin ||
        request.headers["content-type"] !== "application/x-www-form-urlencoded") return void response.writeHead(403).end();
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); if (body.length > 2048) request.destroy(); });
    request.on("end", () => {
      const values = new URLSearchParams(body);
      const selected = values.get("decision");
      if (values.size !== 2 || values.get("digest") !== view.digest ||
          (selected !== "approved" && selected !== "rejected")) return void response.writeHead(400).end();
      decided = true;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end("Decision recorded. You may close this window.");
      response.once("finish", () => resolveDecision(selected));
    });
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const timer = setTimeout(() => rejectDecision(new Error("Local approval timed out")), 300_000);
  try {
    const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
    await new Promise<void>((resolve, reject) => {
      const child = spawn(command, [`${origin}/${token}`], { detached: true, stdio: "ignore", windowsHide: true });
      child.once("error", reject); child.once("spawn", () => { child.unref(); resolve(); });
    });
    return await decision;
  } finally {
    clearTimeout(timer); server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

export class LocalAdaptiveService {
  private readonly approvals = new Set<Digest>();
  private readonly verifier: OwnerAuthorizationVerifier;
  private readonly control: LocalControlStore;
  private readonly recordsDirectory: string;
  private readonly lockPath: string;

  private constructor(private readonly repositoryRoot: string, adapter: Awaited<ReturnType<typeof createPgliteAdapter>>,
    private readonly ownerKey: Buffer, private readonly approval: Approval) {
    this.verifier = ownerVerifier(ownerKey, this.approvals);
    this.control = new LocalControlStore({ adapter, clock, ownerAuthorizationVerifier: this.verifier, resourceDefinitions: WORKERS });
    this.recordsDirectory = localFabricPath(repositoryRoot, "adaptive-runs");
    this.lockPath = localFabricPath(repositoryRoot, "adaptive-lock");
    mkdirSync(this.recordsDirectory, { recursive: true });
  }

  static async open(repositoryRoot: string, approval: Approval = requestAdaptiveApproval): Promise<LocalAdaptiveService> {
    const root = realpathSync(repositoryRoot);
    const keyPath = localFabricPath(root, "adaptive-owner-key");
    mkdirSync(localFabricPath(root), { recursive: true });
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
    const key = readFileSync(keyPath);
    if (key.length !== 32) throw new AgentFabricError("AF_INVALID_STATE", "Invalid adaptive owner key");
    const adapter = await createPgliteAdapter(localFabricPath(root, "adaptive-pglite"));
    return new LocalAdaptiveService(root, adapter, key, approval);
  }

  private path(id: string): string {
    if (!/^[a-f0-9]{32}$/u.test(id)) throw new AgentFabricError("AF_INVALID_STATE", "Invalid adaptive run id");
    return localFabricPath(this.repositoryRoot, "adaptive-runs", `${id}.json`);
  }

  private approvalReceipt(record: AdaptiveRecord): Digest {
    return `sha256:${createHmac("sha256", this.ownerKey).update("forge-local-adaptive-input/v1:")
      .update(JSON.stringify({ id: record.id, repositoryRoot: record.repositoryRoot,
        inputDigest: record.inputDigest, profile: record.profile,
        approvedAt: record.approvedAt })).digest("hex")}`;
  }

  private async assertProfileBinding(record: AdaptiveRecord): Promise<void> {
    if (!record.profile) return;
    const evolution = await LocalEvolutionService.open(this.repositoryRoot);
    try {
      const binding = await evolution.registry.getAttempt(`adaptive:${record.id}`);
      const selected = await evolution.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, record.profile.channel);
      assertLocalAdaptiveInputs(parseLocalAdaptiveInputProfile(selected.artifact),
        record.input.inventory, record.input.constraints);
      if (!binding || binding.versionId !== record.profile.versionId ||
          binding.extensionKey !== LOCAL_ADAPTIVE_EXTENSION_KEY ||
          binding.channel !== record.profile.channel || selected.versionId !== record.profile.versionId) {
        throw new AgentFabricError("AF_CONFLICT", "Approved adaptive profile version is no longer selected");
      }
    } finally { await evolution.close(); }
  }

  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    let descriptor: number;
    try { descriptor = openSync(this.lockPath, "wx", 0o600); }
    catch { throw new AgentFabricError("AF_CONFLICT", "Adaptive owner is busy; if a process crashed, inspect status before manual lock recovery"); }
    try { return await operation(); }
    finally { closeSync(descriptor); unlinkSync(this.lockPath); }
  }

  async propose(value: unknown, channel?: EvolutionChannel): Promise<AdaptiveStatus> {
    const input = validateInput(value);
    return this.locked(async () => {
      const record: AdaptiveRecord = { schemaVersion: 1, id: randomBytes(16).toString("hex"),
        repositoryRoot: this.repositoryRoot, input, inputDigest: digestCanonical(input, sha256Digest),
        phase: "proposed", createdAt: clock.now() };
      if (channel) {
        const evolution = await LocalEvolutionService.open(this.repositoryRoot);
        try {
          const selected = await evolution.resolveSelectedLocalAdaptiveInputs(
            channel, `adaptive:${record.id}`, input.inventory, input.constraints);
          record.profile = { channel, versionId: selected.versionId };
        } finally { await evolution.close(); }
      }
      writeRecord(this.path(record.id), record);
      return this.status(record.id);
    });
  }

  async review(id: string): Promise<AdaptiveStatus> {
    return this.locked(async () => {
      const path = this.path(id);
      const record = readRecord(path);
      if (record.phase !== "proposed") throw new AgentFabricError("AF_CONFLICT", "Adaptive run is not proposed");
      await this.assertProfileBinding(record);
      const decision = await this.approval({ repositoryRoot: this.repositoryRoot, id, input: record.input,
        digest: digestCanonical({ id, repositoryRoot: this.repositoryRoot, inputDigest: record.inputDigest,
          profile: record.profile ?? null }, sha256Digest),
        ...(record.profile ? { profile: record.profile } : {}) });
      if (decision !== "approved" && decision !== "rejected") throw new AgentFabricError("AF_INVALID_STATE", "Invalid owner decision");
      record.phase = decision === "approved" ? "approved" : "rejected";
      if (decision === "approved") {
        record.approvedAt = clock.now();
        record.approvalReceipt = this.approvalReceipt(record);
      }
      writeRecord(path, record);
      return this.status(id);
    });
  }

  async run(id: string, signal?: AbortSignal): Promise<AdaptiveStatus> {
    return this.locked(async () => {
      const path = this.path(id);
      const record = readRecord(path);
      if (record.phase !== "approved") throw new AgentFabricError("AF_CONFLICT", "Adaptive run requires unused owner approval");
      if (!record.approvedAt || clock.now() - record.approvedAt > 300_000) {
        throw new AgentFabricError("AF_GRANT_REJECTED", "Adaptive owner approval expired");
      }
      const expectedReceipt = this.approvalReceipt(record);
      if (!record.approvalReceipt || record.approvalReceipt.length !== expectedReceipt.length ||
          !timingSafeEqual(Buffer.from(record.approvalReceipt), Buffer.from(expectedReceipt))) {
        throw new AgentFabricError("AF_GRANT_REJECTED", "Adaptive owner approval does not match inputs");
      }
      await this.assertProfileBinding(record);
      record.phase = "running";
      record.startedAt = clock.now();
      writeRecord(path, record); // A crash from here is uncertain and never reruns workers.
      const identity = ids(id);
      const now = clock.now();
      const authorization: OwnerAuthorization = {
        authorizationId: identity.authorization, principalId: "owner:local", rootExecutionId: identity.root,
        goalIds: [identity.goal], subjectIds: ["fabric.local.coordinator", "fabric.local.inventory", "fabric.local.constraints"],
        capabilities: ["fabric.local.read"], sourceIds: ["source:owner-input"], targetIds: ["target:adaptive-digest"],
        effectClasses: ["read"], notBefore: now, expiresAt: now + 30_000, maximumAttempts: 3,
        maximumDelegationDepth: 1, resourceCeilings: { workers: 2 },
      };
      const goal: GoalContract = {
        goalId: identity.goal, revision: 1, authorityInvocationId: identity.authorization,
        objectives: ["Digest owner supplied bounded data with two fixed workers"], nonObjectives: ["Run task instructions"],
        acceptanceCriteria: ["Two authoritative child digests and one join",
          ...(record.profile ? [`Selected data profile ${record.profile.versionId}`] : [])],
        allowedEffectClasses: ["read"], prohibitedEffectClasses: ["consequential"],
        sourceBoundary: { sourceIds: ["source:owner-input"], allowExpansion: false },
      };
      try {
        this.approvals.add(digestCanonical(authorization, sha256Digest));
        await this.control.transition(identity.root, (conductor) => {
          conductor.registerOwnerAuthorization(authorization);
          conductor.registerGoal(goal);
          const revision = compileLocalAdaptiveRevision(identity.root, identity.goal, identity.revision);
          conductor.activatePlan(revision, null);
          conductor.registerGrant({ grantId: identity.grant, rootAuthorizationId: identity.authorization,
            subjectId: "fabric.local.coordinator", parentGrantId: null, capabilities: ["fabric.local.read"],
            sourceIds: ["source:owner-input"], targetIds: ["target:adaptive-digest"], effectClasses: ["read"],
            notBefore: now, expiresAt: now + 20_000, maximumAttempts: 3,
            delegationDepthRemaining: 1, resourceCeilings: { workers: 2 } });
          new LocalAdaptiveHarness({ conductor, clock, rootExecutionId: identity.root, revisionId: identity.revision,
            parentGrantId: identity.grant, sourceId: "source:owner-input", targetId: "target:adaptive-digest",
            ...record.input }).prepare();
        });
        const executed = await this.control.runExternal(identity.root, async (conductor) => {
          const harness = new LocalAdaptiveHarness({ conductor, clock, rootExecutionId: identity.root,
            revisionId: identity.revision, parentGrantId: identity.grant, sourceId: "source:owner-input",
            targetId: "target:adaptive-digest", ...record.input });
          harness.resumePrepared();
          return harness.runPrepared(signal);
        });
        record.result = executed.result;
        record.phase = executed.result.join.status === "succeeded" ? "succeeded" : "blocked";
      } catch (error) {
        record.phase = "uncertain";
        record.failure = error instanceof Error ? error.message : String(error);
      } finally {
        this.approvals.clear();
        record.finishedAt = clock.now();
        writeRecord(path, record);
      }
      return this.status(id);
    });
  }

  async status(id: string): Promise<AdaptiveStatus> {
    const record = readRecord(this.path(id));
    if (record.id !== id || record.repositoryRoot !== this.repositoryRoot) {
      throw new AgentFabricError("AF_INVALID_STATE", "Adaptive record belongs to another repository");
    }
    const events = await this.control.readAll(ids(id).root);
    const state = replayControlState(events, { ownerAuthorizationVerifier: this.verifier, resourceDefinitions: WORKERS });
    const outcomes = Object.values(state.outcomes);
    const join = state.outcomes[`attempt:${ids(id).revision}:join`];
    const phase: Phase = join?.status === "succeeded" ? "succeeded" :
      record.phase === "running" ? "uncertain" : record.phase;
    if (record.phase === "succeeded" && !join) throw new AgentFabricError("AF_INVALID_STATE", "Adaptive result has no authoritative join");
    if (record.result?.join.status === "succeeded" &&
        (!join || record.result.join.outcome.reportDigest !== join.reportDigest ||
          record.result.join.outcome.resultDigest !== join.resultDigest)) {
      throw new AgentFabricError("AF_INVALID_STATE", "Adaptive saved result differs from authoritative join");
    }
    return { id, phase, inputDigest: record.inputDigest,
      ...(record.profile ? { profile: record.profile } : {}),
      ...(record.result ? { result: record.result } : {}),
      ...(record.failure ? { failure: record.failure } : {}),
      journal: { events: events.length, childOutcomes: outcomes.filter((outcome) => outcome.attemptId.endsWith(":inventory") || outcome.attemptId.endsWith(":constraints")).length,
        ...(join ? { joinOutcome: { status: join.status, resultDigest: join.resultDigest, reportDigest: join.reportDigest } } : {}) },
    };
  }

  async close(): Promise<void> { await this.control.close(); }
}
