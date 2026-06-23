import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { createPgliteAdapter } from "../runtime/db/pglite-adapter.ts";
import type { DbAdapter } from "../runtime/db/adapter.ts";
import { hashStable, hashUtf8Bytes } from "../compiler/primitives/hash.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import { DELTA_SCHEMA_SQL, DELTA_SCHEMA_VERSION } from "./schema.ts";
import { createDeltaId } from "./ids.ts";
import { redactDeltaPayload } from "./redaction.ts";
import { classifyArtifactKind, classifyDeltaPath, type DeltaSemanticHint } from "./classifier.ts";
import { readDeltaGitSnapshot, type DeltaGitSnapshot } from "./git-observer.ts";
import type { AgentEventEnvelope, AgentMemoryEventRecord } from "../agent-memory/types.ts";

export type DeltaActorKind = "human" | "agent" | "forge" | "ci" | "git" | "unknown";
export type DeltaSessionSource = "forge-dev" | "forge-command" | "agent-adapter" | "git" | "auto";

export interface DeltaOperation {
  id: string;
  sessionId?: string;
  txnId?: string;
  kind: string;
  timestamp: string;
  actorId?: string;
  summary?: string;
  data: Record<string, unknown>;
  redaction?: Record<string, unknown>;
  hash?: string;
  prevHash?: string;
}

export interface DeltaFileChangeInput {
  path: string;
  changeType: "created" | "modified" | "deleted" | "renamed" | "generated";
  hashBefore?: string;
  hashAfter?: string;
  diffSummary?: string;
  semanticHints?: DeltaSemanticHint[];
}

export interface DeltaCommandRunInput {
  commandName: string;
  argv?: string[];
  exitCode?: number;
  durationMs?: number;
  diagnostics?: unknown[];
}

export interface DeltaRuntimeCallInput {
  entryName: string;
  entryKind?: string;
  risk?: string;
  policy?: string;
  tenantScoped?: boolean;
  needsApproval?: boolean;
  result?: string;
  diagnosticCode?: string;
  traceId?: string;
  service?: string;
  language?: string;
}

export interface DeltaProofInput {
  proofKind: string;
  command?: string;
  result: string;
  assurance?: string;
  diagnostics?: unknown[];
  artifactPaths?: string[];
}

export interface DeltaArtifactInput {
  path: string;
  artifactKind?: string;
  hash?: string;
  generated?: boolean;
}

export interface DeltaAppendInput {
  sessionId?: string;
  txnId?: string;
  kind: string;
  actorId?: string;
  summary?: string;
  data?: Record<string, unknown>;
  fileChanges?: DeltaFileChangeInput[];
  commandRun?: DeltaCommandRunInput;
  runtimeCall?: DeltaRuntimeCallInput;
  proof?: DeltaProofInput;
  artifacts?: DeltaArtifactInput[];
  git?: { commitSha?: string; branch?: string; confidence?: number; metadata?: Record<string, unknown> };
}

export interface DeltaAgentMemoryEventInput {
  envelope: AgentEventEnvelope;
  summary?: string;
  bindings?: {
    toolName?: string;
    command?: string;
    exitCode?: number;
    files?: string[];
    entries?: string[];
    proofs?: string[];
    status?: string;
  };
}

export interface DeltaTimelineFilter {
  target?: string;
  kind?: string;
  workSessionId?: string;
  limit?: number;
}

export interface DeltaTimelineEntry {
  id: string;
  kind: string;
  timestamp: string;
  summary?: string;
  data: Record<string, unknown>;
}

export interface DeltaTimelineEntityRef {
  kind: string;
  name: string;
}

export interface DeltaSemanticTimelineEntity extends DeltaTimelineEntityRef {
  id: string;
  eventId: string;
  role: string;
  confidence: number;
}

export interface DeltaSemanticTimelineEvent {
  id: string;
  operationId?: string;
  sessionId?: string;
  changeId?: string;
  timestamp: string;
  kind: string;
  title: string;
  summary?: string;
  severity?: string;
  confidence: number;
  data: Record<string, unknown>;
  entities: DeltaSemanticTimelineEntity[];
}

export interface DeltaSemanticTimelineEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  confidence: number;
  reason?: Record<string, unknown>;
}

export interface DeltaSemanticTimelineFilter extends DeltaTimelineFilter {
  since?: string;
  until?: string;
}

export interface DeltaSemanticTimelineResult {
  entity?: DeltaTimelineEntityRef;
  currentState: Record<string, unknown>;
  events: DeltaSemanticTimelineEvent[];
  causalEdges: DeltaSemanticTimelineEdge[];
  openQuestions: string[];
  projection: {
    version: string;
    lastOperationId?: string;
    lastRebuildAt?: string;
  };
}

export interface DeltaStatus {
  ok: true;
  recording: boolean;
  store: string;
  external?: {
    kind: "pglite-active";
    reason: string;
  };
  session?: {
    id: string;
    startedAt: string;
    operationCount: number;
  };
  workSession?: DeltaWorkSessionSummary;
  recentOperations: Array<{ id: string; kind: string; summary?: string; timestamp: string }>;
  details?: DeltaStatusDetails;
}

export interface DeltaStatusDetails {
  schema: {
    expectedVersion: string;
    storedVersion?: string;
    lastOperationId?: string;
    lastRebuildAt?: string;
  };
  paths: {
    store: string;
    lock: string;
    postmaster: string;
  };
  locks: {
    forgeLockPresent: boolean;
    postmasterPresent: boolean;
  };
  counts: {
    sessions: number;
    operations: number;
    fileChanges: number;
    commandRuns: number;
    runtimeCalls: number;
    proofs: number;
    artifacts: number;
    workSessions: number;
    agentMemoryEvents: number;
    semanticEvents: number;
  };
}

export type DeltaWorkSessionKind = "auto" | "agent" | "human" | "ci" | "git" | "manual-corrected";
export type DeltaWorkSessionStatus = "open" | "idle" | "closed" | "merged" | "split" | "needs-review";
export type DeltaWorkSessionLinkType = "primary" | "related" | "causal" | "weak" | "manual";

export interface DeltaWorkSessionSignal {
  signal: string;
  weight: number;
  value?: string;
  metadata?: Record<string, unknown>;
}

export interface DeltaWorkSessionSummary {
  id: string;
  kind: DeltaWorkSessionKind;
  status: DeltaWorkSessionStatus;
  title: string;
  inferredIntent?: string;
  confidence: number;
  startedAt: string;
  endedAt?: string;
  gitBranch?: string;
  summary?: string;
  operationCount: number;
  reasons: DeltaWorkSessionSignal[];
  metadata: DeltaWorkSessionMetadata;
}

export interface DeltaWorkSessionDetails extends DeltaWorkSessionSummary {
  operations: DeltaTimelineEntry[];
  signals: DeltaWorkSessionSignal[];
}

interface DeltaWorkSessionMetadata {
  files: string[];
  fileClusters: string[];
  entries: string[];
  diagnostics: string[];
  proofs: string[];
  services: string[];
  traces: string[];
  commands: string[];
  operationKinds: string[];
  actorIds: string[];
  lastOperationAt?: string;
  mergedFrom?: string[];
  splitFrom?: string;
  manualTitle?: boolean;
}

interface DeltaOperationContext {
  id: string;
  kind: string;
  timestamp: string;
  actorId?: string;
  summary?: string;
  data: Record<string, unknown>;
  sessionId?: string;
  branch?: string;
  gitHead?: string;
  files: string[];
  fileClusters: string[];
  entries: string[];
  diagnostics: string[];
  proofs: string[];
  services: string[];
  traces: string[];
  commands: string[];
}

export type DeltaStoreAccess = "read" | "write";

export class DeltaStoreBusyError extends Error {
  readonly code = "FORGE_DELTA_BUSY" as const;

  constructor(
    readonly lockPath: string,
    readonly holder: Record<string, unknown> | null,
  ) {
    const holderText = holder?.pid ? ` by pid ${String(holder.pid)}` : "";
    super(`Forge Delta local store is busy${holderText}`);
    this.name = "DeltaStoreBusyError";
  }
}

export interface DeltaStoreBusyInfo {
  code: "FORGE_DELTA_BUSY";
  lockPath: string;
  relativeLockPath: string;
  pid?: number;
  processAlive: boolean;
  createdAt?: string;
  ageMs?: number;
  cwd?: string;
  command?: string;
  holderKnown: boolean;
}

interface DeltaStoreLock {
  path: string;
  token: string;
}

function getDeltaLockPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "delta", "delta.lock");
}

function readLockHolder(lockPath: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function processLooksAlive(pid: unknown): boolean {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EPERM");
  }
}

function lockLooksStale(holder: Record<string, unknown> | null): boolean {
  if (!holder) {
    return true;
  }
  const pid = typeof holder.pid === "number" && Number.isInteger(holder.pid) && holder.pid > 0 ? holder.pid : undefined;
  if (pid) {
    return !processLooksAlive(pid);
  }
  const createdAt = typeof holder.createdAt === "string" ? Date.parse(holder.createdAt) : NaN;
  return !Number.isFinite(createdAt) || Date.now() - createdAt > 30_000;
}

function redactDeltaBusyCommand(command: string): string {
  return command
    .replace(/\b(Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
    .replace(/\b(token|secret|password|passwd|api[-_]?key|authorization)=\S+/gi, "$1=[REDACTED]")
    .replace(/(--(?:token|secret|password|passwd|api-key|authorization))\s+\S+/gi, "$1 [REDACTED]");
}

function displayDeltaBusyCwd(workspaceRoot: string, cwd: string): string {
  if (!isAbsolute(cwd)) {
    return cwd;
  }
  const rel = normalizePath(relative(workspaceRoot, cwd));
  if (rel === "") {
    return ".";
  }
  if (rel === ".." || rel.startsWith("../")) {
    return "[outside-workspace]";
  }
  return rel;
}

export function describeDeltaStoreBusy(
  error: DeltaStoreBusyError,
  workspaceRoot: string,
  now = Date.now(),
): DeltaStoreBusyInfo {
  const holder = error.holder;
  const pid = typeof holder?.pid === "number" && Number.isInteger(holder.pid) && holder.pid > 0
    ? holder.pid
    : undefined;
  const createdAt = typeof holder?.createdAt === "string" ? holder.createdAt : undefined;
  const createdMs = createdAt ? Date.parse(createdAt) : NaN;
  const cwd = typeof holder?.cwd === "string" ? displayDeltaBusyCwd(workspaceRoot, holder.cwd) : undefined;
  const command = typeof holder?.command === "string" ? redactDeltaBusyCommand(holder.command) : undefined;
  return {
    code: "FORGE_DELTA_BUSY",
    lockPath: error.lockPath,
    relativeLockPath: normalizePath(relative(workspaceRoot, error.lockPath)),
    ...(pid ? { pid } : {}),
    processAlive: pid ? processLooksAlive(pid) : false,
    ...(createdAt ? { createdAt } : {}),
    ...(Number.isFinite(createdMs) ? { ageMs: Math.max(0, now - createdMs) } : {}),
    ...(cwd ? { cwd } : {}),
    ...(command ? { command } : {}),
    holderKnown: Boolean(holder),
  };
}

export function summarizeDeltaStoreBusy(info: DeltaStoreBusyInfo): string {
  return [
    `lock=${info.relativeLockPath}`,
    info.pid ? `pid=${info.pid}` : undefined,
    info.processAlive ? "process=alive" : "process=unknown-or-exited",
    typeof info.ageMs === "number" ? `age=${Math.round(info.ageMs / 1000)}s` : undefined,
    info.cwd ? `cwd=${info.cwd}` : undefined,
    info.command ? `command=${info.command}` : undefined,
  ].filter(Boolean).join(", ");
}

function acquireDeltaStoreLock(workspaceRoot: string): DeltaStoreLock {
  const lockPath = getDeltaLockPath(workspaceRoot);
  mkdirSync(dirname(lockPath), { recursive: true });
  const token = `${process.pid}:${Date.now()}:${createDeltaId("op")}`;
  const content = `${JSON.stringify({
    pid: process.pid,
    token,
    createdAt: new Date().toISOString(),
    cwd: process.cwd(),
    command: process.argv.slice(0, 6).join(" "),
  }, null, 2)}\n`;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      try {
        writeFileSync(fd, content, "utf8");
      } finally {
        closeSync(fd);
      }
      return { path: lockPath, token };
    } catch (error) {
      const holder = readLockHolder(lockPath);
      if (attempt === 0 && lockLooksStale(holder)) {
        try {
          unlinkSync(lockPath);
          continue;
        } catch {
          // Another process may have refreshed the lock first; report the live holder below.
        }
      }
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === "EEXIST" || existsSync(lockPath)) {
        throw new DeltaStoreBusyError(lockPath, holder);
      }
      throw error;
    }
  }

  throw new DeltaStoreBusyError(lockPath, readLockHolder(lockPath));
}

export function probeDeltaStoreBusy(workspaceRoot: string): DeltaStoreBusyError | null {
  const lockPath = getDeltaLockPath(workspaceRoot);
  if (!existsSync(lockPath)) {
    return null;
  }
  const holder = readLockHolder(lockPath);
  if (lockLooksStale(holder)) {
    try {
      unlinkSync(lockPath);
      return null;
    } catch {
      return new DeltaStoreBusyError(lockPath, readLockHolder(lockPath));
    }
  }
  return new DeltaStoreBusyError(lockPath, holder);
}

function releaseDeltaStoreLock(lock: DeltaStoreLock): void {
  const holder = readLockHolder(lock.path);
  if (holder?.token !== lock.token) {
    return;
  }
  try {
    unlinkSync(lock.path);
  } catch {
    // Best effort; stale locks are cleaned by the next opener when their process is gone.
  }
}

function deltaStoreInitialized(storePath: string): boolean {
  return existsSync(join(storePath, "PG_VERSION"));
}

function readPglitePostmasterHolder(storePath: string): Record<string, unknown> | null {
  const postmasterPath = join(storePath, "postmaster.pid");
  if (!existsSync(postmasterPath)) {
    return null;
  }
  try {
    const lines = readFileSync(postmasterPath, "utf8").split(/\r?\n/);
    const pid = Number(lines[0]);
    return {
      ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}),
      createdAt: statSync(postmasterPath).mtime.toISOString(),
      command: "pglite postmaster.pid",
    };
  } catch {
    return {
      command: "pglite postmaster.pid",
    };
  }
}

export class DeltaStore {
  private closed = false;

  private constructor(
    readonly workspaceRoot: string,
    readonly storePath: string,
    private readonly adapter: DbAdapter,
    private readonly lock: DeltaStoreLock | null,
  ) {}

  static async open(workspaceRoot: string, options: { access?: DeltaStoreAccess } = {}): Promise<DeltaStore> {
    const storePath = getDeltaStorePath(workspaceRoot);
    mkdirSync(dirname(storePath), { recursive: true });
    const initializedBeforeOpen = deltaStoreInitialized(storePath);
    const lock = options.access === "read" ? null : acquireDeltaStoreLock(workspaceRoot);
    let store: DeltaStore | null = null;
    try {
      const adapter = await createPgliteAdapter(storePath);
      store = new DeltaStore(workspaceRoot, storePath, adapter, lock);
      if (options.access !== "read" || !initializedBeforeOpen) {
        await store.init();
      } else if (await store.needsSchemaInit()) {
        await store.close();
        store = null;
        const migrateLock = acquireDeltaStoreLock(workspaceRoot);
        try {
          const migrateAdapter = await createPgliteAdapter(storePath);
          store = new DeltaStore(workspaceRoot, storePath, migrateAdapter, migrateLock);
          await store.init();
        } catch (error) {
          releaseDeltaStoreLock(migrateLock);
          throw error;
        }
      }
      return store;
    } catch (error) {
      if (store) {
        await store.close().catch(() => undefined);
      } else if (lock) {
        releaseDeltaStoreLock(lock);
      }
      if (!(error instanceof DeltaStoreBusyError)) {
        const holder = readPglitePostmasterHolder(storePath);
        if (holder) {
          throw new DeltaStoreBusyError(join(storePath, "postmaster.pid"), holder);
        }
      }
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    try {
      await this.adapter.close();
    } finally {
      if (this.lock) {
        releaseDeltaStoreLock(this.lock);
      }
    }
  }

  async init(): Promise<void> {
    for (const sql of DELTA_SCHEMA_SQL) {
      await this.adapter.query(sql);
    }
    await this.adapter.query(
      `INSERT INTO delta_meta (key, value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
      ["schemaVersion", DELTA_SCHEMA_VERSION, new Date().toISOString()],
    );
  }

  async ensureActor(kind: DeltaActorKind, name: string, metadata: Record<string, unknown> = {}): Promise<string> {
    const existing = await this.adapter.query(`SELECT id FROM actors WHERE kind = $1 AND name = $2 LIMIT 1`, [kind, name]);
    const id = typeof existing.rows[0]?.id === "string" ? existing.rows[0].id : createDeltaId("actor");
    if (existing.rows.length === 0) {
      await this.adapter.query(
        `INSERT INTO actors (id, kind, name, metadata_json, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [id, kind, name, JSON.stringify(metadata), new Date().toISOString()],
      );
    }
    return id;
  }

  async createSession(input: {
    source: DeltaSessionSource;
    summary?: string;
    metadata?: Record<string, unknown>;
    git?: DeltaGitSnapshot;
  }): Promise<string> {
    const id = createDeltaId("sess");
    const git = input.git ?? readDeltaGitSnapshot(this.workspaceRoot);
    await this.adapter.query(
      `INSERT INTO sessions (id, workspace_root, source, branch, started_at, summary, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        id,
        this.workspaceRoot,
        input.source,
        git.branch ?? null,
        new Date().toISOString(),
        input.summary ?? null,
        JSON.stringify({ ...(input.metadata ?? {}), git }),
      ],
    );
    await this.appendOperation({
      sessionId: id,
      kind: "session.started",
      summary: `Started ${input.source} session`,
      data: { source: input.source, git },
    });
    return id;
  }

  async endSession(sessionId: string, summary?: string): Promise<void> {
    await this.adapter.query(`UPDATE sessions SET ended_at = $1, summary = COALESCE($2, summary) WHERE id = $3`, [
      new Date().toISOString(),
      summary ?? null,
      sessionId,
    ]);
    await this.appendOperation({
      sessionId,
      kind: "session.ended",
      summary: summary ?? "Ended session",
      data: {},
    });
  }

  async appendOperation(input: DeltaAppendInput): Promise<string> {
    const operationId = createDeltaId("op");
    const timestamp = new Date().toISOString();
    const data = input.data ?? {};
    const redacted = redactDeltaPayload(data);
    const previous = await this.adapter.query(`SELECT hash FROM operations ORDER BY timestamp DESC, id DESC LIMIT 1`);
    const prevHash = typeof previous.rows[0]?.hash === "string" ? previous.rows[0].hash : null;
    const hash = hashStable(JSON.stringify({
      id: operationId,
      kind: input.kind,
      timestamp,
      data: redacted.value,
      prevHash,
    }));

    await this.adapter.query(
      `INSERT INTO operations (id, session_id, txn_id, kind, timestamp, actor_id, summary, data_json, redaction_json, hash, prev_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        operationId,
        input.sessionId ?? null,
        input.txnId ?? null,
        input.kind,
        timestamp,
        input.actorId ?? null,
        input.summary ?? null,
        JSON.stringify(redacted.value),
        JSON.stringify(redacted.redaction),
        hash,
        prevHash,
      ],
    );

    for (const fileChange of input.fileChanges ?? []) {
      await this.insertFileChange(operationId, fileChange);
    }
    if (input.commandRun) {
      await this.insertCommandRun(operationId, input.commandRun);
    }
    if (input.runtimeCall) {
      await this.insertRuntimeCall(operationId, input.runtimeCall);
    }
    if (input.proof) {
      await this.insertProof(operationId, input.proof);
    }
    for (const artifact of input.artifacts ?? []) {
      await this.insertArtifact(operationId, artifact);
    }
    if (input.git) {
      await this.adapter.query(
        `INSERT INTO git_mappings (id, operation_id, commit_sha, branch, detected_at, confidence, metadata_json)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          createDeltaId("gitmap"),
          operationId,
          input.git.commitSha ?? null,
          input.git.branch ?? null,
          timestamp,
          input.git.confidence ?? 0.5,
          JSON.stringify(input.git.metadata ?? {}),
        ],
      );
    }
    await this.inferWorkSessionForOperation(operationId).catch(() => undefined);
    return operationId;
  }

  async recordAgentMemoryEvent(input: DeltaAgentMemoryEventInput): Promise<AgentMemoryEventRecord> {
    const envelope = input.envelope;
    const timestamp = envelope.event.timestamp || new Date().toISOString();
    const sourceId = deterministicTimelineId("agsrc", [
      String(envelope.source.agent),
      String(envelope.source.integration),
      String(envelope.capture.trustLevel),
    ]);
    await this.adapter.query(
      `INSERT INTO agent_event_sources (id, source_name, source_kind, integration_kind, trust_level, config_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE
       SET source_name = EXCLUDED.source_name,
           source_kind = EXCLUDED.source_kind,
           integration_kind = EXCLUDED.integration_kind,
           trust_level = EXCLUDED.trust_level,
           config_json = EXCLUDED.config_json`,
      [
        sourceId,
        String(envelope.source.agent),
        "external-agent",
        String(envelope.source.integration),
        envelope.capture.trustLevel,
        JSON.stringify({ version: envelope.source.version }),
        timestamp,
      ],
    );

    const actorId = await this.ensureActor("agent", envelope.actor.name, {
      source: envelope.source.agent,
      model: envelope.actor.model,
      integration: envelope.source.integration,
    });
    const forgeSessionId = envelope.session.forgeSessionId ?? await this.createSession({
      source: "agent-adapter",
      summary: `${envelope.source.agent} ${envelope.event.kind}`,
      metadata: {
        externalSessionId: envelope.session.externalSessionId,
        source: envelope.source,
      },
      git: { branch: envelope.workspace.gitBranch, head: envelope.workspace.gitHead },
    });
    const bindings = input.bindings ?? {};
    const operationId = await this.appendOperation({
      sessionId: forgeSessionId,
      actorId,
      kind: envelope.event.kind,
      summary: input.summary,
      data: {
        source: envelope.source,
        session: envelope.session,
        capture: envelope.capture,
        privacy: envelope.privacy,
        payload: envelope.payload,
        toolName: bindings.toolName,
        status: bindings.status,
        entries: bindings.entries,
        files: bindings.files,
        proofs: bindings.proofs,
      },
      commandRun: bindings.command
        ? {
            commandName: bindings.command,
            argv: [bindings.command],
            exitCode: bindings.exitCode,
          }
        : undefined,
      fileChanges: bindings.files?.map((path) => ({
        path,
        changeType: envelope.event.kind === "agent.file.changed" ? "modified" : "modified",
        semanticHints: classifyDeltaPath(path),
      })),
      proof: bindings.proofs?.[0]
        ? {
            proofKind: bindings.proofs[0],
            command: bindings.command,
            result: bindings.status === "failed" ? "failed" : "passed",
          }
        : undefined,
      git: envelope.workspace.gitHead || envelope.workspace.gitBranch
        ? {
            commitSha: envelope.workspace.gitHead,
            branch: envelope.workspace.gitBranch,
            confidence: envelope.capture.confidence,
            metadata: { source: envelope.source.agent },
          }
        : undefined,
    });

    const externalEventId = createDeltaId("aevt");
    const payloadJson = JSON.stringify(envelope.payload);
    await this.adapter.query(
      `INSERT INTO external_agent_events
       (id, source_id, external_session_id, external_turn_id, event_kind, captured_at, payload_redacted_json, payload_hash, raw_stored, normalization_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 'normalized')`,
      [
        externalEventId,
        sourceId,
        envelope.session.externalSessionId ?? null,
        envelope.session.turnId ?? null,
        envelope.event.kind,
        timestamp,
        payloadJson,
        hashStable(payloadJson),
      ],
    );

    const memoryId = createDeltaId("amem");
    const data = {
      envelope,
      bindings,
    };
    await this.adapter.query(
      `INSERT INTO agent_memory_events
       (id, external_event_id, forge_session_id, forge_change_id, operation_id, normalized_kind, summary, confidence, data_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        memoryId,
        externalEventId,
        forgeSessionId,
        null,
        operationId,
        envelope.event.kind,
        input.summary ?? null,
        envelope.capture.confidence,
        JSON.stringify(data),
      ],
    );

    return {
      id: memoryId,
      externalEventId,
      sourceName: String(envelope.source.agent),
      integrationKind: String(envelope.source.integration),
      trustLevel: envelope.capture.trustLevel,
      externalSessionId: envelope.session.externalSessionId,
      externalTurnId: envelope.session.turnId,
      eventKind: envelope.event.kind,
      normalizedKind: envelope.event.kind,
      summary: input.summary,
      confidence: envelope.capture.confidence,
      capturedAt: timestamp,
      operationId,
      data,
    };
  }

  async listAgentMemoryEvents(filter: { target?: string; limit?: number } = {}): Promise<AgentMemoryEventRecord[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter.target) {
      params.push(`%${filter.target}%`);
      clauses.push(`(ame.summary ILIKE $${params.length} OR ame.data_json ILIKE $${params.length})`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.adapter.query(
      `SELECT ame.*, e.external_session_id, e.external_turn_id, e.event_kind, e.captured_at,
              s.source_name, s.integration_kind, s.trust_level
       FROM agent_memory_events ame
       JOIN external_agent_events e ON e.id = ame.external_event_id
       JOIN agent_event_sources s ON s.id = e.source_id
       ${where}
       ORDER BY e.captured_at DESC, ame.id DESC
       LIMIT ${limit}`,
      params,
    );
    return rows.rows.reverse().map((row) => ({
      id: String(row.id),
      externalEventId: String(row.external_event_id),
      sourceName: String(row.source_name),
      integrationKind: String(row.integration_kind),
      trustLevel: String(row.trust_level),
      externalSessionId: typeof row.external_session_id === "string" ? row.external_session_id : undefined,
      externalTurnId: typeof row.external_turn_id === "string" ? row.external_turn_id : undefined,
      eventKind: String(row.event_kind),
      normalizedKind: String(row.normalized_kind),
      summary: typeof row.summary === "string" ? row.summary : undefined,
      confidence: Number(row.confidence ?? 0),
      capturedAt: String(row.captured_at),
      operationId: typeof row.operation_id === "string" ? row.operation_id : undefined,
      data: parseJsonRecord(row.data_json),
    }));
  }

  async status(): Promise<DeltaStatus> {
    const sessionRows = await this.adapter.query(
      `SELECT s.id, s.started_at, COUNT(o.id)::int AS operation_count
       FROM sessions s
       LEFT JOIN operations o ON o.session_id = s.id
       GROUP BY s.id, s.started_at
       ORDER BY s.started_at DESC
       LIMIT 1`,
    );
    const recent = await this.adapter.query(
      `SELECT id, kind, summary, timestamp FROM operations ORDER BY timestamp DESC, id DESC LIMIT 8`,
    );
    const session = sessionRows.rows[0];
    return {
      ok: true,
      recording: true,
      store: normalizePath(relative(this.workspaceRoot, this.storePath)),
      session: session
        ? {
            id: String(session.id),
            startedAt: String(session.started_at),
            operationCount: Number(session.operation_count ?? 0),
          }
        : undefined,
      workSession: await this.currentWorkSession(),
      recentOperations: recent.rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        summary: typeof row.summary === "string" ? row.summary : undefined,
        timestamp: String(row.timestamp),
      })),
    };
  }

  async statusDetails(): Promise<DeltaStatusDetails> {
    const metaRows = await this.adapter.query(
      `SELECT key, value FROM delta_meta WHERE key IN ('schemaVersion', 'semantic.lastOperationId', 'semantic.lastRebuildAt')`,
    );
    const meta = new Map(metaRows.rows.map((row) => [String(row.key), String(row.value)]));
    const countQueries = await Promise.all([
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM sessions`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM operations`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM file_changes`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM command_runs`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM runtime_calls`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM proofs`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM artifacts`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM work_sessions`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM agent_memory_events`),
      this.adapter.query(`SELECT COUNT(*)::int AS count FROM timeline_events`),
    ]);
    const countAt = (index: number) => Number(countQueries[index]?.rows[0]?.count ?? 0);
    const lockPath = getDeltaLockPath(this.workspaceRoot);
    const postmasterPath = join(this.storePath, "postmaster.pid");
    const storedVersion = meta.get("schemaVersion");
    const lastOperationId = meta.get("semantic.lastOperationId");
    const lastRebuildAt = meta.get("semantic.lastRebuildAt");
    return {
      schema: {
        expectedVersion: DELTA_SCHEMA_VERSION,
        ...(storedVersion ? { storedVersion } : {}),
        ...(lastOperationId ? { lastOperationId } : {}),
        ...(lastRebuildAt ? { lastRebuildAt } : {}),
      },
      paths: {
        store: normalizePath(relative(this.workspaceRoot, this.storePath)),
        lock: normalizePath(relative(this.workspaceRoot, lockPath)),
        postmaster: normalizePath(relative(this.workspaceRoot, postmasterPath)),
      },
      locks: {
        forgeLockPresent: existsSync(lockPath),
        postmasterPresent: existsSync(postmasterPath),
      },
      counts: {
        sessions: countAt(0),
        operations: countAt(1),
        fileChanges: countAt(2),
        commandRuns: countAt(3),
        runtimeCalls: countAt(4),
        proofs: countAt(5),
        artifacts: countAt(6),
        workSessions: countAt(7),
        agentMemoryEvents: countAt(8),
        semanticEvents: countAt(9),
      },
    };
  }

  async timeline(filter: DeltaTimelineFilter = {}): Promise<DeltaTimelineEntry[]> {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter.kind) {
      params.push(filter.kind);
      clauses.push(`o.kind = $${params.length}`);
    }
    if (filter.workSessionId) {
      const workSessionId = await this.resolveWorkSessionId(filter.workSessionId);
      if (workSessionId) {
        params.push(workSessionId);
        clauses.push(`EXISTS (
          SELECT 1 FROM work_session_operations wso
          WHERE wso.operation_id = o.id AND wso.work_session_id = $${params.length}
        )`);
      } else {
        return [];
      }
    }
    if (filter.target) {
      params.push(filter.target);
      const exactIndex = params.length;
      params.push(`%${filter.target}%`);
      const likeIndex = params.length;
      clauses.push(`(
        o.summary ILIKE $${likeIndex}
        OR o.data_json ILIKE $${likeIndex}
        OR EXISTS (SELECT 1 FROM file_changes f WHERE f.operation_id = o.id AND f.path = $${exactIndex})
        OR EXISTS (SELECT 1 FROM runtime_calls r WHERE r.operation_id = o.id AND r.entry_name = $${exactIndex})
        OR EXISTS (SELECT 1 FROM artifacts a WHERE a.operation_id = o.id AND a.path = $${exactIndex})
      )`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.adapter.query(
      `SELECT o.id, o.kind, o.timestamp, o.summary, o.data_json
       FROM operations o
       ${where}
       ORDER BY o.timestamp DESC, o.id DESC
       LIMIT ${limit}`,
      params,
    );
    return result.rows.reverse().map(rowToTimelineEntry);
  }

  async semanticTimeline(filter: DeltaSemanticTimelineFilter = {}): Promise<DeltaSemanticTimelineResult> {
    await this.ensureSemanticTimelineFresh();
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 200));
    const entity = parseTimelineEntityTarget(filter.target);
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (filter.kind) {
      const kindFilters = normalizeSemanticKindFilter(filter.kind);
      if (kindFilters.length === 1) {
        params.push(kindFilters[0]);
        clauses.push(`te.event_kind = $${params.length}`);
      } else {
        const placeholders = kindFilters.map((kind) => {
          params.push(kind);
          return `$${params.length}`;
        });
        clauses.push(`te.event_kind IN (${placeholders.join(", ")})`);
      }
    }
    if (filter.since) {
      params.push(filter.since);
      clauses.push(`te.timestamp >= $${params.length}`);
    }
    if (filter.until) {
      params.push(filter.until);
      clauses.push(`te.timestamp <= $${params.length}`);
    }
    if (filter.workSessionId) {
      const workSessionId = await this.resolveWorkSessionId(filter.workSessionId);
      if (!workSessionId) {
        return await this.emptySemanticTimeline(entity);
      }
      params.push(workSessionId);
      clauses.push(`EXISTS (
        SELECT 1 FROM work_session_operations wso
        WHERE wso.operation_id = te.operation_id AND wso.work_session_id = $${params.length}
      )`);
    }
    if (entity) {
      params.push(entity.kind);
      const kindIndex = params.length;
      params.push(entity.name);
      const nameIndex = params.length;
      clauses.push(`EXISTS (
        SELECT 1 FROM timeline_entities ten
        WHERE ten.timeline_event_id = te.id
          AND ten.entity_kind = $${kindIndex}
          AND ten.entity_name = $${nameIndex}
      )`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = await this.adapter.query(
      `SELECT te.*
       FROM timeline_events te
       ${where}
       ORDER BY te.timestamp DESC, te.id DESC
       LIMIT ${limit}`,
      params,
    );
    let events = rows.rows.reverse().map(rowToSemanticTimelineEvent);
    for (const event of events) {
      event.entities = await this.timelineEntitiesForEvent(event.id);
    }
    const baseEventIds = events.map((event) => event.id);
    let expandedIds = [...baseEventIds];
    for (let depth = 0; depth < 2; depth += 1) {
      const touchingEdges = expandedIds.length > 0 ? await this.timelineEdgesTouchingEvents(expandedIds) : [];
      const nextIds = uniqueStrings(touchingEdges.flatMap((edge) => [edge.from, edge.to]));
      if (nextIds.every((id) => expandedIds.includes(id))) {
        break;
      }
      expandedIds = uniqueStrings([...expandedIds, ...nextIds]);
    }
    const linkedIds = expandedIds.filter((id) => !baseEventIds.includes(id));
    if (linkedIds.length > 0) {
      events = [...events, ...(await this.semanticEventsByIds(linkedIds))]
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
    }
    const eventIds = events.map((event) => event.id);
    const causalEdges = eventIds.length > 0 ? await this.timelineEdgesForEvents(eventIds) : [];
    const projection = await this.timelineProjectionState();
    const currentState = await this.semanticCurrentState(entity, events, causalEdges);
    const openQuestions = semanticOpenQuestions(entity, currentState, events);
    return { entity, currentState, events, causalEdges, openQuestions, projection };
  }

  async rebuildSemanticTimeline(): Promise<void> {
    await this.adapter.query(`DELETE FROM timeline_edges`);
    await this.adapter.query(`DELETE FROM timeline_entities`);
    await this.adapter.query(`DELETE FROM timeline_events`);
    const operations = await this.adapter.query(`SELECT id FROM operations ORDER BY timestamp, id`);
    const projected: ProjectedTimelineEvent[] = [];
    for (const row of operations.rows) {
      const context = await this.loadOperationContext(String(row.id));
      if (!context) {
        continue;
      }
      const event = await this.projectOperationToSemanticEvent(context);
      if (!event) {
        continue;
      }
      projected.push(event);
      await this.insertSemanticTimelineEvent(event);
    }
    await this.insertSemanticTimelineEdges(projected);
    const latest = await this.latestOperationId();
    const now = new Date().toISOString();
    const graphHash = hashStable(JSON.stringify(projected.map((event) => ({
      id: event.event.id,
      kind: event.event.kind,
      entities: event.entities.map((entity) => `${entity.kind}:${entity.name}:${entity.role}`),
    }))));
    await this.adapter.query(
      `INSERT INTO timeline_projection_state (id, last_operation_id, last_rebuild_at, projection_version, graph_hash)
       VALUES ('semantic', $1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE
       SET last_operation_id = EXCLUDED.last_operation_id,
           last_rebuild_at = EXCLUDED.last_rebuild_at,
           projection_version = EXCLUDED.projection_version,
           graph_hash = EXCLUDED.graph_hash`,
      [latest, now, DELTA_SCHEMA_VERSION, graphHash],
    );
  }

  private async needsSchemaInit(): Promise<boolean> {
    try {
      const meta = await this.adapter.query(`SELECT value FROM delta_meta WHERE key = $1 LIMIT 1`, ["schemaVersion"]);
      const version = typeof meta.rows[0]?.value === "string" ? meta.rows[0].value : "";
      if (version !== DELTA_SCHEMA_VERSION) {
        return true;
      }
      await this.adapter.query(`SELECT 1 FROM agent_memory_events LIMIT 1`);
      return false;
    } catch {
      return true;
    }
  }

  async explain(thing: string): Promise<Record<string, unknown>> {
    if (thing === "session" || thing.startsWith("session:")) {
      const sessionId = thing === "session" ? "current" : thing.slice("session:".length);
      const session = await this.getWorkSessionDetails(sessionId || "current");
      return {
        thing,
        type: "work-session",
        session,
        git: session?.gitBranch ? { branch: session.gitBranch } : await this.latestGitMapping(),
      };
    }
    const semanticTimeline = await this.semanticTimeline({ target: thing, limit: 100 });
    const timeline = await this.timeline({ target: thing, limit: 100 });
    const runtime = await this.adapter.query(`SELECT * FROM runtime_calls WHERE entry_name = $1 ORDER BY operation_id`, [thing]);
    const files = await this.adapter.query(`SELECT * FROM file_changes WHERE path = $1 ORDER BY operation_id`, [thing]);
    const artifacts = await this.adapter.query(`SELECT * FROM artifacts WHERE path = $1 ORDER BY operation_id`, [thing]);
    const manifestOps = await this.adapter.query(
      `SELECT id, timestamp, summary, data_json FROM operations WHERE kind IN ('manifest.imported', 'manifest.validated') AND data_json ILIKE $1 ORDER BY timestamp`,
      [`%${thing}%`],
    );
    const proofs = await this.adapter.query(
      `SELECT p.* FROM proofs p JOIN operations o ON o.id = p.operation_id WHERE o.data_json ILIKE $1 OR p.diagnostics_json ILIKE $1 ORDER BY o.timestamp`,
      [`%${thing}%`],
    );
    const latestRuntime = runtime.rows[runtime.rows.length - 1];
    const type = latestRuntime
      ? "runtime-entry"
      : files.rows.length > 0
        ? "file"
        : artifacts.rows.length > 0
          ? "artifact"
          : proofs.rows.length > 0
            ? "proof"
            : "unknown";
    return {
      thing,
      type: semanticTimeline.events.length > 0 ? semanticTimeline.entity?.kind ?? type : type,
      origin: manifestOps.rows.map((row) => parseJsonRecord(row.data_json)),
      runtime: latestRuntime ? normalizeRow(latestRuntime) : null,
      files: files.rows.map(normalizeRow),
      artifacts: artifacts.rows.map(normalizeRow),
      proofs: proofs.rows.map(normalizeRow),
      semanticTimeline,
      timeline,
      workSessions: await this.workSessionsForThing(thing),
      git: await this.latestGitMapping(),
    };
  }

  async recordFilePath(
    sessionId: string | undefined,
    path: string,
    changeType: DeltaFileChangeInput["changeType"] = "modified",
    summary?: string,
  ): Promise<void> {
    const relativePath = normalizePath(path);
    const absolutePath = join(this.workspaceRoot, relativePath);
    const exists = existsSync(absolutePath);
    const hashAfter = exists && statSync(absolutePath).isFile() ? hashUtf8Bytes(readFileSync(absolutePath)) : undefined;
    await this.appendOperation({
      sessionId,
      kind: changeType === "generated" ? "artifact.generated" : `file.${changeType === "modified" ? "changed" : changeType}`,
      summary: summary ?? `${changeType} ${relativePath}`,
      data: { path: relativePath, changeType },
      fileChanges: [{
        path: relativePath,
        changeType,
        hashAfter,
        semanticHints: classifyDeltaPath(relativePath),
      }],
      artifacts: changeType === "generated"
        ? [{ path: relativePath, artifactKind: classifyArtifactKind(relativePath), hash: hashAfter, generated: true }]
        : undefined,
    });
  }

  async currentWorkSession(): Promise<DeltaWorkSessionSummary | undefined> {
    const result = await this.adapter.query(
      `SELECT ws.*, COUNT(wso.operation_id)::int AS operation_count
       FROM work_sessions ws
       LEFT JOIN work_session_operations wso ON wso.work_session_id = ws.id
       WHERE ws.status IN ('open', 'idle', 'needs-review')
       GROUP BY ws.id
       ORDER BY ws.updated_at DESC, ws.started_at DESC
       LIMIT 1`,
    );
    return result.rows[0] ? this.rowToWorkSessionSummary(result.rows[0]) : undefined;
  }

  async listWorkSessions(limit = 20): Promise<DeltaWorkSessionSummary[]> {
    const capped = Math.max(1, Math.min(limit, 100));
    const result = await this.adapter.query(
      `SELECT ws.*, COUNT(wso.operation_id)::int AS operation_count
       FROM work_sessions ws
       LEFT JOIN work_session_operations wso ON wso.work_session_id = ws.id
       GROUP BY ws.id
       ORDER BY ws.updated_at DESC, ws.started_at DESC
       LIMIT ${capped}`,
    );
    const sessions: DeltaWorkSessionSummary[] = [];
    for (const row of result.rows) {
      sessions.push(await this.rowToWorkSessionSummary(row));
    }
    return sessions;
  }

  async getWorkSessionDetails(idOrCurrent: string): Promise<DeltaWorkSessionDetails | undefined> {
    const id = await this.resolveWorkSessionId(idOrCurrent);
    if (!id) {
      return undefined;
    }
    const result = await this.adapter.query(
      `SELECT ws.*, COUNT(wso.operation_id)::int AS operation_count
       FROM work_sessions ws
       LEFT JOIN work_session_operations wso ON wso.work_session_id = ws.id
       WHERE ws.id = $1
       GROUP BY ws.id`,
      [id],
    );
    if (!result.rows[0]) {
      return undefined;
    }
    const summary = await this.rowToWorkSessionSummary(result.rows[0]);
    const operations = await this.timeline({ workSessionId: id, limit: 200 });
    const signals = await this.signalsForWorkSession(id, 100);
    return { ...summary, operations, signals };
  }

  async renameWorkSession(idOrCurrent: string, title: string): Promise<DeltaWorkSessionDetails | undefined> {
    const id = await this.resolveWorkSessionId(idOrCurrent);
    if (!id) {
      return undefined;
    }
    const now = new Date().toISOString();
    const existing = await this.getWorkSessionDetails(id);
    const metadata = existing ? { ...existing.metadata, manualTitle: true } : { ...emptyWorkSessionMetadata(), manualTitle: true };
    await this.adapter.query(
      `UPDATE work_sessions
       SET title = $1, kind = 'manual-corrected', confidence = GREATEST(confidence, 0.9), metadata_json = $2, updated_at = $3
       WHERE id = $4`,
      [title, JSON.stringify(metadata), now, id],
    );
    await this.insertWorkSessionSummary(id, `Renamed session to "${title}".`, "human-edited");
    return this.getWorkSessionDetails(id);
  }

  async detachWorkSessionOperation(operationId: string): Promise<boolean> {
    const linked = await this.adapter.query(
      `SELECT DISTINCT work_session_id FROM work_session_operations WHERE operation_id = $1`,
      [operationId],
    );
    await this.adapter.query(`DELETE FROM work_session_operations WHERE operation_id = $1`, [operationId]);
    for (const row of linked.rows) {
      if (typeof row.work_session_id === "string") {
        await this.rebuildWorkSessionFromOperations(row.work_session_id);
      }
    }
    return linked.rows.length > 0;
  }

  async mergeWorkSessions(targetIdOrCurrent: string, sourceId: string): Promise<DeltaWorkSessionDetails | undefined> {
    const targetId = await this.resolveWorkSessionId(targetIdOrCurrent);
    const source = await this.resolveWorkSessionId(sourceId);
    if (!targetId || !source || targetId === source) {
      return undefined;
    }
    const now = new Date().toISOString();
    await this.adapter.query(
      `UPDATE work_session_operations SET work_session_id = $1 WHERE work_session_id = $2`,
      [targetId, source],
    );
    await this.adapter.query(
      `UPDATE work_sessions SET status = 'merged', ended_at = $1, updated_at = $1 WHERE id = $2`,
      [now, source],
    );
    const target = await this.getWorkSessionDetails(targetId);
    const metadata = target
      ? mergeWorkSessionMetadata(target.metadata, { ...emptyWorkSessionMetadata(), mergedFrom: [source] })
      : emptyWorkSessionMetadata();
    await this.adapter.query(`UPDATE work_sessions SET metadata_json = $1, updated_at = $2 WHERE id = $3`, [
      JSON.stringify(metadata),
      now,
      targetId,
    ]);
    await this.rebuildWorkSessionFromOperations(targetId);
    await this.insertWorkSessionSummary(targetId, `Merged work session ${source} into ${targetId}.`, "human-edited");
    return this.getWorkSessionDetails(targetId);
  }

  async splitWorkSession(idOrCurrent: string, fromOperationId: string): Promise<DeltaWorkSessionDetails | undefined> {
    const id = await this.resolveWorkSessionId(idOrCurrent);
    if (!id) {
      return undefined;
    }
    const operationRows = await this.adapter.query(
      `SELECT o.id, o.timestamp
       FROM operations o
       JOIN work_session_operations wso ON wso.operation_id = o.id
       WHERE wso.work_session_id = $1
       ORDER BY o.timestamp, o.id`,
      [id],
    );
    const index = operationRows.rows.findIndex((row) => row.id === fromOperationId);
    if (index < 0) {
      return undefined;
    }
    const moved = operationRows.rows.slice(index).map((row) => String(row.id));
    const firstContext = await this.loadOperationContext(moved[0]!);
    if (!firstContext) {
      return undefined;
    }
    const now = new Date().toISOString();
    const newId = createDeltaId("worksess");
    const metadata = { ...contextToWorkSessionMetadata(firstContext), splitFrom: id };
    await this.adapter.query(
      `INSERT INTO work_sessions (
        id, workspace_root, kind, status, title, inferred_intent, confidence, started_at, actor_ids_json,
        git_branch, git_head_start, summary, metadata_json, created_at, updated_at
       ) VALUES ($1, $2, 'manual-corrected', 'needs-review', $3, $4, 0.65, $5, $6, $7, $8, $9, $10, $11, $11)`,
      [
        newId,
        this.workspaceRoot,
        inferWorkSessionTitle(firstContext, metadata),
        inferIntent(firstContext, metadata),
        firstContext.timestamp,
        JSON.stringify(metadata.actorIds),
        firstContext.branch ?? null,
        firstContext.gitHead ?? null,
        summarizeWorkSession(metadata),
        JSON.stringify(metadata),
        now,
      ],
    );
    for (const operationId of moved) {
      await this.adapter.query(
        `UPDATE work_session_operations SET work_session_id = $1, link_type = 'manual', confidence = 0.8 WHERE work_session_id = $2 AND operation_id = $3`,
        [newId, id, operationId],
      );
    }
    await this.rebuildWorkSessionFromOperations(id);
    await this.rebuildWorkSessionFromOperations(newId);
    await this.insertWorkSessionSummary(newId, `Split from work session ${id}.`, "human-edited");
    return this.getWorkSessionDetails(newId);
  }

  private async inferWorkSessionForOperation(operationId: string): Promise<void> {
    const context = await this.loadOperationContext(operationId);
    if (!context || !shouldInferWorkSession(context)) {
      return;
    }
    await this.closeIdleWorkSessions(context.timestamp);
    const candidates = await this.candidateWorkSessions(context);
    const scored = candidates
      .map((candidate) => ({ candidate, score: scoreWorkSessionCandidate(context, candidate) }))
      .sort((a, b) => b.score.score - a.score.score);
    const best = scored[0];
    if (!best || best.score.score < 0.4) {
      await this.createWorkSessionForOperation(context);
      return;
    }
    await this.attachOperationToWorkSession(
      best.candidate.id,
      context,
      best.score.score >= 0.65 ? "primary" : "weak",
      best.score.score,
      best.score.signals,
    );
  }

  private async createWorkSessionForOperation(context: DeltaOperationContext): Promise<string> {
    const id = createDeltaId("worksess");
    const now = new Date().toISOString();
    const metadata = contextToWorkSessionMetadata(context);
    const title = inferWorkSessionTitle(context, metadata);
    const confidence = initialWorkSessionConfidence(context);
    const status: DeltaWorkSessionStatus = confidence >= 0.65 ? "open" : "needs-review";
    const summary = summarizeWorkSession(metadata);
    await this.adapter.query(
      `INSERT INTO work_sessions (
        id, workspace_root, kind, status, title, inferred_intent, confidence, started_at, actor_ids_json,
        git_branch, git_head_start, summary, metadata_json, created_at, updated_at
       ) VALUES ($1, $2, 'auto', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13)`,
      [
        id,
        this.workspaceRoot,
        status,
        title,
        inferIntent(context, metadata),
        confidence,
        context.timestamp,
        JSON.stringify(metadata.actorIds),
        context.branch ?? null,
        context.gitHead ?? null,
        summary,
        JSON.stringify(metadata),
        now,
      ],
    );
    const signals = seedSignalsForContext(context);
    await this.linkOperationToWorkSession(id, context.id, "primary", confidence, signals);
    await this.insertWorkSessionSignals(id, context.id, signals);
    await this.insertWorkSessionSummary(id, summary, "auto-short");
    return id;
  }

  private async attachOperationToWorkSession(
    workSessionId: string,
    context: DeltaOperationContext,
    linkType: DeltaWorkSessionLinkType,
    confidence: number,
    signals: DeltaWorkSessionSignal[],
  ): Promise<void> {
    const current = await this.getWorkSessionDetails(workSessionId);
    const metadata = mergeWorkSessionMetadata(current?.metadata ?? emptyWorkSessionMetadata(), contextToWorkSessionMetadata(context));
    const title = current?.metadata.manualTitle ? current.title : inferWorkSessionTitle(context, metadata);
    const nextConfidence = roundConfidence(Math.max(confidence, ((current?.confidence ?? 0.5) * 0.7) + (confidence * 0.3)));
    const status: DeltaWorkSessionStatus = linkType === "weak" || nextConfidence < 0.65 ? "needs-review" : "open";
    const summary = summarizeWorkSession(metadata);
    await this.linkOperationToWorkSession(workSessionId, context.id, linkType, confidence, signals);
    await this.insertWorkSessionSignals(workSessionId, context.id, signals);
    await this.adapter.query(
      `UPDATE work_sessions
       SET status = $1, title = $2, inferred_intent = $3, confidence = $4, ended_at = NULL,
           actor_ids_json = $5, git_branch = COALESCE(git_branch, $6), git_head_end = COALESCE($7, git_head_end),
           summary = $8, metadata_json = $9, updated_at = $10
       WHERE id = $11`,
      [
        status,
        title,
        inferIntent(context, metadata),
        nextConfidence,
        JSON.stringify(metadata.actorIds),
        context.branch ?? null,
        context.gitHead ?? null,
        summary,
        JSON.stringify(metadata),
        context.timestamp,
        workSessionId,
      ],
    );
    await this.insertWorkSessionSummary(workSessionId, summary, "auto-short");
  }

  private async linkOperationToWorkSession(
    workSessionId: string,
    operationId: string,
    linkType: DeltaWorkSessionLinkType,
    confidence: number,
    signals: DeltaWorkSessionSignal[],
  ): Promise<void> {
    await this.adapter.query(
      `INSERT INTO work_session_operations (work_session_id, operation_id, link_type, confidence, reason_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (work_session_id, operation_id)
       DO UPDATE SET link_type = EXCLUDED.link_type, confidence = EXCLUDED.confidence, reason_json = EXCLUDED.reason_json`,
      [
        workSessionId,
        operationId,
        linkType,
        roundConfidence(confidence),
        JSON.stringify(signals),
        new Date().toISOString(),
      ],
    );
  }

  private async insertWorkSessionSignals(
    workSessionId: string,
    operationId: string,
    signals: DeltaWorkSessionSignal[],
  ): Promise<void> {
    for (const signal of signals) {
      await this.adapter.query(
        `INSERT INTO work_session_signals (id, work_session_id, operation_id, signal_type, weight, value, metadata_json, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          createDeltaId("wssig"),
          workSessionId,
          operationId,
          signal.signal,
          signal.weight,
          signal.value ?? null,
          JSON.stringify(signal.metadata ?? {}),
          new Date().toISOString(),
        ],
      );
    }
  }

  private async insertWorkSessionSummary(workSessionId: string, content: string, summaryType: string): Promise<void> {
    await this.adapter.query(
      `INSERT INTO work_session_summaries (id, work_session_id, summary_type, content, generated_by, created_at, redaction_json)
       VALUES ($1, $2, $3, $4, 'forge-delta-h45', $5, $6)`,
      [createDeltaId("wssum"), workSessionId, summaryType, content, new Date().toISOString(), JSON.stringify({ redacted: false })],
    );
  }

  private async candidateWorkSessions(context: DeltaOperationContext): Promise<DeltaWorkSessionSummary[]> {
    const result = await this.adapter.query(
      `SELECT ws.*, COUNT(wso.operation_id)::int AS operation_count
       FROM work_sessions ws
       LEFT JOIN work_session_operations wso ON wso.work_session_id = ws.id
       WHERE ws.status IN ('open', 'idle', 'needs-review')
         AND (
           ws.updated_at >= $1
           OR ws.git_branch = $2
           OR ws.metadata_json ILIKE $3
           OR ws.metadata_json ILIKE $4
         )
       GROUP BY ws.id
       ORDER BY ws.updated_at DESC, ws.started_at DESC
       LIMIT 20`,
      [
        new Date(Date.parse(context.timestamp) - 2 * 60 * 60 * 1000).toISOString(),
        context.branch ?? "",
        context.entries[0] ? `%${context.entries[0]}%` : "__forge_delta_no_entry__",
        context.services[0] ? `%${context.services[0]}%` : "__forge_delta_no_service__",
      ],
    );
    const candidates: DeltaWorkSessionSummary[] = [];
    for (const row of result.rows) {
      candidates.push(await this.rowToWorkSessionSummary(row));
    }
    return candidates;
  }

  private async closeIdleWorkSessions(nowIso: string): Promise<void> {
    const idleBefore = new Date(Date.parse(nowIso) - 2 * 60 * 60 * 1000).toISOString();
    await this.adapter.query(
      `UPDATE work_sessions
       SET status = 'idle', ended_at = COALESCE(ended_at, updated_at)
       WHERE status = 'open' AND updated_at < $1`,
      [idleBefore],
    );
  }

  private async loadOperationContext(operationId: string): Promise<DeltaOperationContext | undefined> {
    const operation = await this.adapter.query(
      `SELECT o.*, s.branch AS session_branch, s.metadata_json AS session_metadata_json
       FROM operations o
       LEFT JOIN sessions s ON s.id = o.session_id
       WHERE o.id = $1`,
      [operationId],
    );
    const row = operation.rows[0];
    if (!row) {
      return undefined;
    }
    const data = parseJsonRecord(row.data_json);
    const sessionMetadata = parseJsonRecord(row.session_metadata_json);
    const git = parseJsonRecord(data.git);
    const sessionGit = parseJsonRecord(sessionMetadata.git);
    const filesResult = await this.adapter.query(`SELECT * FROM file_changes WHERE operation_id = $1`, [operationId]);
    const runtimeResult = await this.adapter.query(`SELECT * FROM runtime_calls WHERE operation_id = $1`, [operationId]);
    const proofResult = await this.adapter.query(`SELECT * FROM proofs WHERE operation_id = $1`, [operationId]);
    const artifactResult = await this.adapter.query(`SELECT * FROM artifacts WHERE operation_id = $1`, [operationId]);
    const commandResult = await this.adapter.query(`SELECT * FROM command_runs WHERE operation_id = $1`, [operationId]);
    const files = uniqueStrings([
      ...filesResult.rows.map((item) => item.path),
      ...artifactResult.rows.map((item) => item.path),
      data.path,
    ]);
    const fileClusters = uniqueStrings([
      ...filesResult.rows.flatMap((item) => parseSemanticHints(item.semantic_hints_json).map((hint) => hint.kind)),
      ...files.map(clusterForPath),
    ]);
    const entries = uniqueStrings([
      ...runtimeResult.rows.map((item) => item.entry_name),
      data.entryName,
      ...arrayOfStrings(data.entries),
      ...arrayOfStrings(data.entryNames),
    ]);
    const diagnostics = uniqueStrings([
      ...runtimeResult.rows.map((item) => item.diagnostic_code),
      ...proofResult.rows.flatMap((item) => diagnosticCodesFromJson(item.diagnostics_json)),
      ...commandResult.rows.flatMap((item) => diagnosticCodesFromJson(item.diagnostics_json)),
      data.diagnosticCode,
    ]);
    const proofs = uniqueStrings([
      ...proofResult.rows.map((item) => item.proof_kind),
      row.kind === "proof.run" ? data.command : undefined,
    ]);
    const services = uniqueStrings([
      ...runtimeResult.rows.map((item) => item.service),
      data.service,
      ...arrayOfStrings(data.services),
      typeof data.path === "string" ? serviceFromManifestPath(data.path) : undefined,
      ...entries.map((entry) => entry.split(".")[0]),
    ]);
    const traces = uniqueStrings([
      ...runtimeResult.rows.map((item) => item.trace_id),
      data.traceId,
    ]);
    const commands = uniqueStrings([
      ...commandResult.rows.map((item) => item.command_name),
      data.command,
      data.toolName,
    ]);
    return {
      id: String(row.id),
      kind: String(row.kind),
      timestamp: String(row.timestamp),
      actorId: typeof row.actor_id === "string" ? row.actor_id : undefined,
      summary: typeof row.summary === "string" ? row.summary : undefined,
      data,
      sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
      branch: stringOrUndefined(git.branch) ?? stringOrUndefined(sessionGit.branch) ?? stringOrUndefined(row.session_branch),
      gitHead: stringOrUndefined(git.head) ?? stringOrUndefined(git.commitSha) ?? stringOrUndefined(sessionGit.head),
      files,
      fileClusters,
      entries,
      diagnostics,
      proofs,
      services,
      traces,
      commands,
    };
  }

  private async rowToWorkSessionSummary(row: Record<string, unknown>): Promise<DeltaWorkSessionSummary> {
    const metadata = normalizeWorkSessionMetadata(parseJsonRecord(row.metadata_json));
    const id = String(row.id);
    const latestSignals = await this.signalsForWorkSession(id, 8);
    return {
      id,
      kind: normalizeWorkSessionKind(row.kind),
      status: normalizeWorkSessionStatus(row.status),
      title: typeof row.title === "string" && row.title ? row.title : "Work session",
      inferredIntent: typeof row.inferred_intent === "string" ? row.inferred_intent : undefined,
      confidence: Number(row.confidence ?? 0),
      startedAt: String(row.started_at),
      endedAt: typeof row.ended_at === "string" ? row.ended_at : undefined,
      gitBranch: typeof row.git_branch === "string" ? row.git_branch : undefined,
      summary: typeof row.summary === "string" ? row.summary : undefined,
      operationCount: Number(row.operation_count ?? 0),
      reasons: latestSignals,
      metadata,
    };
  }

  private async signalsForWorkSession(workSessionId: string, limit: number): Promise<DeltaWorkSessionSignal[]> {
    const result = await this.adapter.query(
      `SELECT signal_type, weight, value, metadata_json
       FROM work_session_signals
       WHERE work_session_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT ${Math.max(1, Math.min(limit, 200))}`,
      [workSessionId],
    );
    return result.rows.map((row) => ({
      signal: String(row.signal_type),
      weight: Number(row.weight ?? 0),
      value: typeof row.value === "string" ? row.value : undefined,
      metadata: parseJsonRecord(row.metadata_json),
    }));
  }

  private async workSessionsForThing(thing: string): Promise<DeltaWorkSessionSummary[]> {
    const result = await this.adapter.query(
      `SELECT ws.*, COUNT(wso2.operation_id)::int AS operation_count
       FROM work_sessions ws
       JOIN work_session_operations wso ON wso.work_session_id = ws.id
       JOIN operations o ON o.id = wso.operation_id
       LEFT JOIN work_session_operations wso2 ON wso2.work_session_id = ws.id
       WHERE o.summary ILIKE $1
          OR o.data_json ILIKE $1
          OR EXISTS (SELECT 1 FROM runtime_calls r WHERE r.operation_id = o.id AND r.entry_name = $2)
          OR EXISTS (SELECT 1 FROM file_changes f WHERE f.operation_id = o.id AND f.path = $2)
          OR EXISTS (SELECT 1 FROM artifacts a WHERE a.operation_id = o.id AND a.path = $2)
       GROUP BY ws.id
       ORDER BY ws.started_at`,
      [`%${thing}%`, thing],
    );
    const sessions: DeltaWorkSessionSummary[] = [];
    for (const row of result.rows) {
      sessions.push(await this.rowToWorkSessionSummary(row));
    }
    return sessions;
  }

  private async resolveWorkSessionId(idOrCurrent: string): Promise<string | undefined> {
    if (idOrCurrent === "current") {
      return (await this.currentWorkSession())?.id;
    }
    const exists = await this.adapter.query(`SELECT id FROM work_sessions WHERE id = $1 LIMIT 1`, [idOrCurrent]);
    return typeof exists.rows[0]?.id === "string" ? exists.rows[0].id : undefined;
  }

  private async rebuildWorkSessionFromOperations(workSessionId: string): Promise<void> {
    const links = await this.adapter.query(
      `SELECT operation_id FROM work_session_operations WHERE work_session_id = $1 ORDER BY created_at`,
      [workSessionId],
    );
    if (links.rows.length === 0) {
      await this.adapter.query(
        `UPDATE work_sessions SET status = 'closed', ended_at = COALESCE(ended_at, updated_at), updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), workSessionId],
      );
      return;
    }
    let metadata = emptyWorkSessionMetadata();
    let first: DeltaOperationContext | undefined;
    let last: DeltaOperationContext | undefined;
    for (const row of links.rows) {
      const context = await this.loadOperationContext(String(row.operation_id));
      if (!context) {
        continue;
      }
      first ??= context;
      last = context;
      metadata = mergeWorkSessionMetadata(metadata, contextToWorkSessionMetadata(context));
    }
    if (!first || !last) {
      return;
    }
    const existing = await this.getWorkSessionDetails(workSessionId);
    metadata = mergeWorkSessionMetadata(existing?.metadata ?? emptyWorkSessionMetadata(), metadata);
    const title = existing?.metadata.manualTitle ? existing.title : inferWorkSessionTitle(last, metadata);
    await this.adapter.query(
      `UPDATE work_sessions
       SET title = $1, inferred_intent = $2, started_at = $3, actor_ids_json = $4, git_branch = $5,
           git_head_start = $6, git_head_end = $7, summary = $8, metadata_json = $9, updated_at = $10
       WHERE id = $11`,
      [
        title,
        inferIntent(last, metadata),
        first.timestamp,
        JSON.stringify(metadata.actorIds),
        first.branch ?? null,
        first.gitHead ?? null,
        last.gitHead ?? null,
        summarizeWorkSession(metadata),
        JSON.stringify(metadata),
        last.timestamp,
        workSessionId,
      ],
    );
  }

  private async insertFileChange(operationId: string, fileChange: DeltaFileChangeInput): Promise<void> {
    await this.adapter.query(
      `INSERT INTO file_changes (id, operation_id, path, change_type, hash_before, hash_after, diff_summary, semantic_hints_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        createDeltaId("filechg"),
        operationId,
        normalizePath(fileChange.path),
        fileChange.changeType,
        fileChange.hashBefore ?? null,
        fileChange.hashAfter ?? null,
        fileChange.diffSummary ?? null,
        JSON.stringify(fileChange.semanticHints ?? classifyDeltaPath(fileChange.path)),
      ],
    );
  }

  private async insertCommandRun(operationId: string, commandRun: DeltaCommandRunInput): Promise<void> {
    const redacted = redactDeltaPayload({ argv: commandRun.argv ?? [] });
    await this.adapter.query(
      `INSERT INTO command_runs (id, operation_id, command_name, argv_redacted_json, exit_code, duration_ms, diagnostics_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        createDeltaId("cmdrun"),
        operationId,
        commandRun.commandName,
        JSON.stringify(redacted.value.argv),
        commandRun.exitCode ?? null,
        commandRun.durationMs ?? null,
        JSON.stringify(commandRun.diagnostics ?? []),
      ],
    );
  }

  private async insertRuntimeCall(operationId: string, runtimeCall: DeltaRuntimeCallInput): Promise<void> {
    await this.adapter.query(
      `INSERT INTO runtime_calls (id, operation_id, entry_name, entry_kind, risk, policy, tenant_scoped, result, diagnostic_code, trace_id, service, language, needs_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        createDeltaId("rtcall"),
        operationId,
        runtimeCall.entryName,
        runtimeCall.entryKind ?? null,
        runtimeCall.risk ?? null,
        runtimeCall.policy ?? null,
        runtimeCall.tenantScoped === undefined ? null : runtimeCall.tenantScoped ? 1 : 0,
        runtimeCall.result ?? null,
        runtimeCall.diagnosticCode ?? null,
        runtimeCall.traceId ?? null,
        runtimeCall.service ?? null,
        runtimeCall.language ?? null,
        runtimeCall.needsApproval === undefined ? null : runtimeCall.needsApproval ? 1 : 0,
      ],
    );
  }

  private async insertProof(operationId: string, proof: DeltaProofInput): Promise<void> {
    await this.adapter.query(
      `INSERT INTO proofs (id, operation_id, proof_kind, command, result, assurance, diagnostics_json, artifact_paths_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        createDeltaId("proof"),
        operationId,
        proof.proofKind,
        proof.command ?? null,
        proof.result,
        proof.assurance ?? null,
        JSON.stringify(proof.diagnostics ?? []),
        JSON.stringify(proof.artifactPaths ?? []),
      ],
    );
  }

  private async insertArtifact(operationId: string, artifact: DeltaArtifactInput): Promise<void> {
    await this.adapter.query(
      `INSERT INTO artifacts (id, operation_id, path, artifact_kind, hash, generated)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        createDeltaId("artifact"),
        operationId,
        normalizePath(artifact.path),
        artifact.artifactKind ?? classifyArtifactKind(artifact.path),
        artifact.hash ?? null,
        artifact.generated === false ? 0 : 1,
      ],
    );
  }

  private async ensureSemanticTimelineFresh(): Promise<void> {
    const latest = await this.latestOperationId();
    const state = await this.timelineProjectionState();
    if (state.lastOperationId === latest && state.version === DELTA_SCHEMA_VERSION) {
      return;
    }
    await this.rebuildSemanticTimeline();
  }

  private async emptySemanticTimeline(entity?: DeltaTimelineEntityRef): Promise<DeltaSemanticTimelineResult> {
    return {
      entity,
      currentState: {},
      events: [],
      causalEdges: [],
      openQuestions: entity ? [`No timeline events found for ${entity.kind}:${entity.name}`] : [],
      projection: await this.timelineProjectionState(),
    };
  }

  private async latestOperationId(): Promise<string | undefined> {
    const result = await this.adapter.query(`SELECT id FROM operations ORDER BY timestamp DESC, id DESC LIMIT 1`);
    return typeof result.rows[0]?.id === "string" ? result.rows[0].id : undefined;
  }

  private async timelineProjectionState(): Promise<DeltaSemanticTimelineResult["projection"]> {
    const result = await this.adapter.query(`SELECT * FROM timeline_projection_state WHERE id = 'semantic' LIMIT 1`);
    const row = result.rows[0];
    return {
      version: typeof row?.projection_version === "string" ? row.projection_version : DELTA_SCHEMA_VERSION,
      lastOperationId: typeof row?.last_operation_id === "string" ? row.last_operation_id : undefined,
      lastRebuildAt: typeof row?.last_rebuild_at === "string" ? row.last_rebuild_at : undefined,
    };
  }

  private async projectOperationToSemanticEvent(context: DeltaOperationContext): Promise<ProjectedTimelineEvent | undefined> {
    if (context.kind === "session.started" || context.kind === "session.ended") {
      return undefined;
    }
    const runtimeResult = await this.adapter.query(`SELECT * FROM runtime_calls WHERE operation_id = $1`, [context.id]);
    const proofResult = await this.adapter.query(`SELECT * FROM proofs WHERE operation_id = $1`, [context.id]);
    const artifactResult = await this.adapter.query(`SELECT * FROM artifacts WHERE operation_id = $1`, [context.id]);
    const fileResult = await this.adapter.query(`SELECT * FROM file_changes WHERE operation_id = $1`, [context.id]);
    const runtime = runtimeResult.rows[0];
    const proof = proofResult.rows[0];
    const eventKind = semanticEventKindForOperation(context, runtime, proof);
    if (!eventKind) {
      return undefined;
    }
    const title = semanticTitleForOperation(context, eventKind, runtime, proof);
    const severity = semanticSeverity(eventKind);
    const artifacts = summarizeTimelineArtifacts(artifactResult.rows.map(normalizeRow));
    const event: DeltaSemanticTimelineEvent = {
      id: deterministicTimelineId("tle", [context.id, eventKind]),
      operationId: context.id,
      sessionId: context.sessionId,
      timestamp: context.timestamp,
      kind: eventKind,
      title,
      summary: context.summary,
      severity,
      confidence: confidenceForSemanticEvent(context, eventKind),
      data: redactedTimelineData({
        operationKind: context.kind,
        ...context.data,
        runtime: runtime ? normalizeRow(runtime) : undefined,
        proof: proof ? normalizeRow(proof) : undefined,
        artifacts,
      }),
      entities: [],
    };
    const entities = timelineEntitiesFromContext(context, eventKind, runtimeResult.rows, proofResult.rows, fileResult.rows, artifactResult.rows)
      .map((entity, index) => ({
        ...entity,
        id: deterministicTimelineId("tlent", [event.id, entity.kind, entity.name, entity.role, String(index)]),
        eventId: event.id,
      }));
    event.entities = entities;
    return { event, entities };
  }

  private async insertSemanticTimelineEvent(projected: ProjectedTimelineEvent): Promise<void> {
    const event = projected.event;
    await this.adapter.query(
      `INSERT INTO timeline_events (id, operation_id, session_id, change_id, timestamp, event_kind, title, summary, severity, confidence, data_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        event.id,
        event.operationId ?? null,
        event.sessionId ?? null,
        event.changeId ?? null,
        event.timestamp,
        event.kind,
        event.title,
        event.summary ?? null,
        event.severity ?? null,
        event.confidence,
        JSON.stringify(event.data),
      ],
    );
    for (const entity of projected.entities) {
      await this.adapter.query(
        `INSERT INTO timeline_entities (id, timeline_event_id, entity_kind, entity_name, role, confidence)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entity.id, event.id, entity.kind, entity.name, entity.role, entity.confidence],
      );
    }
  }

  private async insertSemanticTimelineEdges(projected: ProjectedTimelineEvent[]): Promise<void> {
    const edges: DeltaSemanticTimelineEdge[] = [];
    for (const denied of projected.filter((item) => item.event.kind === "denied" || item.event.kind === "diagnostic.emitted")) {
      const entry = denied.entities.find((entity) => entity.kind === "runtime-entry")?.name;
      const diagnostic = denied.entities.find((entity) => entity.kind === "diagnostic")?.name;
      const policy = denied.entities.find((entity) => entity.kind === "policy")?.name;
      if (!entry && !diagnostic) {
        continue;
      }
      const repair = projected.find((item) =>
        item.event.timestamp >= denied.event.timestamp &&
        item.event.kind === "policy.changed" &&
        (!policy || item.entities.some((entity) => entity.kind === "policy" && entity.name === policy)),
      );
      if (!repair) {
        continue;
      }
      edges.push({
        id: deterministicTimelineId("tledge", [denied.event.id, repair.event.id, "fixed"]),
        from: denied.event.id,
        to: repair.event.id,
        kind: "fixed",
        confidence: 0.82,
        reason: { diagnostic, entry, policy, rule: "diagnostic-to-policy-repair" },
      });
      const success = projected.find((item) =>
        item.event.timestamp >= repair.event.timestamp &&
        item.event.kind === "executed" &&
        (!entry || item.entities.some((entity) => entity.kind === "runtime-entry" && entity.name === entry)),
      );
      if (success) {
        edges.push({
          id: deterministicTimelineId("tledge", [repair.event.id, success.event.id, "validated"]),
          from: repair.event.id,
          to: success.event.id,
          kind: "validated",
          confidence: 0.86,
          reason: { diagnostic, entry, policy, rule: "repair-to-success" },
        });
      }
    }
    for (const proof of projected.filter((item) => item.event.kind === "proof.passed" || item.event.kind === "proof.failed")) {
      const previous = [...projected]
        .reverse()
        .find((item) =>
          item.event.timestamp < proof.event.timestamp &&
          item.event.kind !== "proof.passed" &&
          item.event.kind !== "proof.failed" &&
          hasSharedSemanticEntity(item.entities, proof.entities),
        );
      if (previous) {
        edges.push({
          id: deterministicTimelineId("tledge", [previous.event.id, proof.event.id, "validated"]),
          from: previous.event.id,
          to: proof.event.id,
          kind: proof.event.kind === "proof.passed" ? "validated" : "failed",
          confidence: 0.74,
          reason: { rule: "related-change-to-proof" },
        });
      }
    }
    for (const edge of uniqueEdges(edges)) {
      await this.adapter.query(
        `INSERT INTO timeline_edges (id, from_event_id, to_event_id, edge_kind, confidence, reason_json)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [edge.id, edge.from, edge.to, edge.kind, edge.confidence, JSON.stringify(edge.reason ?? {})],
      );
    }
  }

  private async timelineEntitiesForEvent(eventId: string): Promise<DeltaSemanticTimelineEntity[]> {
    const result = await this.adapter.query(
      `SELECT * FROM timeline_entities WHERE timeline_event_id = $1 ORDER BY role, entity_kind, entity_name`,
      [eventId],
    );
    return result.rows.map(rowToSemanticTimelineEntity);
  }

  private async timelineEdgesForEvents(eventIds: string[]): Promise<DeltaSemanticTimelineEdge[]> {
    const values = eventIds.map((_, index) => `$${index + 1}`).join(", ");
    const result = await this.adapter.query(
      `SELECT * FROM timeline_edges
       WHERE from_event_id IN (${values}) AND to_event_id IN (${values})
       ORDER BY edge_kind, id`,
      eventIds,
    );
    return result.rows.map(rowToSemanticTimelineEdge);
  }

  private async timelineEdgesTouchingEvents(eventIds: string[]): Promise<DeltaSemanticTimelineEdge[]> {
    const values = eventIds.map((_, index) => `$${index + 1}`).join(", ");
    const result = await this.adapter.query(
      `SELECT * FROM timeline_edges
       WHERE from_event_id IN (${values}) OR to_event_id IN (${values})
       ORDER BY edge_kind, id`,
      eventIds,
    );
    return result.rows.map(rowToSemanticTimelineEdge);
  }

  private async semanticEventsByIds(eventIds: string[]): Promise<DeltaSemanticTimelineEvent[]> {
    const values = eventIds.map((_, index) => `$${index + 1}`).join(", ");
    const result = await this.adapter.query(
      `SELECT * FROM timeline_events WHERE id IN (${values}) ORDER BY timestamp, id`,
      eventIds,
    );
    const events = result.rows.map(rowToSemanticTimelineEvent);
    for (const event of events) {
      event.entities = await this.timelineEntitiesForEvent(event.id);
    }
    return events;
  }

  private async semanticCurrentState(
    entity: DeltaTimelineEntityRef | undefined,
    events: DeltaSemanticTimelineEvent[],
    edges: DeltaSemanticTimelineEdge[],
  ): Promise<Record<string, unknown>> {
    if (!entity) {
      return {
        eventCount: events.length,
        latestEventKind: events[events.length - 1]?.kind,
      };
    }
    if (entity.kind === "runtime-entry" || entity.kind === "agent-tool") {
      const runtime = await this.adapter.query(`SELECT * FROM runtime_calls WHERE entry_name = $1 ORDER BY operation_id DESC LIMIT 1`, [entity.name]);
      const row = runtime.rows[0];
      const latestRelevantChange = latestEventTimestamp(events, ["modified", "policy.changed", "imported", "generated"]);
      const latestProof = latestEventTimestamp(events, ["proof.passed"]);
      return {
        kind: row ? row.entry_kind : undefined,
        service: row ? row.service : undefined,
        language: row ? row.language : undefined,
        risk: row ? row.risk : undefined,
        policy: row ? row.policy : undefined,
        tenantScoped: row?.tenant_scoped === 1 || row?.tenant_scoped === true,
        needsApproval: row?.needs_approval === 1 || row?.needs_approval === true,
        lastResult: row ? row.result : undefined,
        lastDiagnostic: row ? row.diagnostic_code : undefined,
        proofStatus: latestProof && latestRelevantChange && Date.parse(latestRelevantChange) > Date.parse(latestProof) ? "stale" : latestProof ? "fresh" : "unknown",
        exportedToGit: events.some((event) => event.kind === "git.exported"),
      };
    }
    if (entity.kind === "policy") {
      const entries = await this.adapter.query(
        `SELECT DISTINCT entry_name FROM runtime_calls WHERE policy = $1 ORDER BY entry_name LIMIT 50`,
        [entity.name],
      );
      return {
        entries: entries.rows.map((row) => String(row.entry_name)),
        lastChangedAt: latestEventTimestamp(events, ["policy.changed"]),
        lastDenialAt: latestEventTimestamp(events, ["denied"]),
        resolved: edges.some((edge) => edge.kind === "validated" || edge.kind === "fixed"),
      };
    }
    if (entity.kind === "proof") {
      const latestProofResult = await this.adapter.query(
        `SELECT te.timestamp, te.event_kind
         FROM timeline_events te
         JOIN timeline_entities ten ON ten.timeline_event_id = te.id
         WHERE ten.entity_kind = 'proof' AND ten.entity_name = $1
         ORDER BY te.timestamp DESC, te.id DESC
         LIMIT 1`,
        [entity.name],
      );
      const latestProof = typeof latestProofResult.rows[0]?.timestamp === "string" ? latestProofResult.rows[0].timestamp : undefined;
      const latestProofKind = typeof latestProofResult.rows[0]?.event_kind === "string" ? latestProofResult.rows[0].event_kind : undefined;
      const latestChangeResult = await this.adapter.query(
        `SELECT timestamp FROM timeline_events
         WHERE event_kind IN ('modified', 'policy.changed', 'generated', 'imported')
         ORDER BY timestamp DESC, id DESC
         LIMIT 1`,
      );
      const latestChange = typeof latestChangeResult.rows[0]?.timestamp === "string" ? latestChangeResult.rows[0].timestamp : undefined;
      return {
        lastRunAt: latestProof,
        proofStatus: latestProof && latestChange && Date.parse(latestChange) > Date.parse(latestProof) ? "stale" : latestProof ? "fresh" : "unknown",
        lastResult: latestProofKind,
      };
    }
    if (entity.kind === "diagnostic") {
      return {
        occurrences: events.filter((event) => event.kind === "denied" || event.kind === "diagnostic.emitted").length,
        resolved: edges.some((edge) => edge.kind === "fixed" || edge.kind === "validated"),
      };
    }
    if (entity.kind === "external-service") {
      return {
        entries: uniqueStrings(events.flatMap((event) => event.entities.filter((item) => item.kind === "runtime-entry").map((item) => item.name))),
        lastFailureAt: latestEventTimestamp(events, ["failed", "denied"]),
        lastSuccessAt: latestEventTimestamp(events, ["executed"]),
      };
    }
    return {
      eventCount: events.length,
      latestEventKind: events[events.length - 1]?.kind,
      latestEventAt: events[events.length - 1]?.timestamp,
    };
  }

  private async latestGitMapping(): Promise<Record<string, unknown> | null> {
    const result = await this.adapter.query(`SELECT * FROM git_mappings ORDER BY detected_at DESC LIMIT 1`);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }
}

export function getDeltaStorePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "delta", "delta.db");
}

interface ProjectedTimelineEvent {
  event: DeltaSemanticTimelineEvent;
  entities: DeltaSemanticTimelineEntity[];
}

function semanticEventKindForOperation(
  context: DeltaOperationContext,
  runtime: Record<string, unknown> | undefined,
  proof: Record<string, unknown> | undefined,
): string | undefined {
  if (context.kind === "manifest.imported" || context.kind === "manifest.validated") {
    return "imported";
  }
  if (context.kind === "artifact.generated" || context.kind === "generate.completed") {
    return "generated";
  }
  if (context.kind === "proof.run" || proof) {
    const result = String(proof?.result ?? context.data.result ?? context.data.exitCode ?? "");
    return result === "passed" || result === "success" || result === "0" || result === "true" ? "proof.passed" : "proof.failed";
  }
  if (context.kind.startsWith("runtime.entry") || runtime) {
    const result = String(runtime?.result ?? context.data.result ?? context.kind);
    if (result === "denied" || context.kind.includes("denied")) {
      return "denied";
    }
    if (result === "failed" || result === "error" || context.kind.includes("failed")) {
      return "failed";
    }
    return "executed";
  }
  if (context.kind === "diagnostic.emitted" || context.diagnostics.length > 0) {
    return "diagnostic.emitted";
  }
  if (context.kind === "git.commit.detected" || context.kind === "git.mapping.detected") {
    return "git.exported";
  }
  if (context.kind.startsWith("agent.") || context.kind.startsWith("approval.")) {
    return context.kind;
  }
  if (context.kind.startsWith("file.")) {
    return context.fileClusters.includes("policy.change") ? "policy.changed" : "modified";
  }
  if (context.kind.startsWith("command.")) {
    return context.data.exitCode === 0 ? "executed" : "failed";
  }
  return undefined;
}

function semanticTitleForOperation(
  context: DeltaOperationContext,
  eventKind: string,
  runtime: Record<string, unknown> | undefined,
  proof: Record<string, unknown> | undefined,
): string {
  const entry = context.entries[0] ?? stringOrUndefined(runtime?.entry_name);
  const file = context.files[0];
  const diagnostic = context.diagnostics[0] ?? stringOrUndefined(runtime?.diagnostic_code);
  const proofKind = context.proofs[0] ?? stringOrUndefined(proof?.proof_kind);
  const service = context.services[0];
  if (eventKind === "imported") {
    return service ? `Imported ${service}` : `Imported ${file ?? "manifest"}`;
  }
  if (eventKind === "generated") {
    return file ? `Generated ${file}` : "Generated artifacts";
  }
  if (eventKind === "denied") {
    return `${entry ?? "runtime entry"} denied${diagnostic ? `: ${diagnostic}` : ""}`;
  }
  if (eventKind === "executed") {
    return `${entry ?? context.commands[0] ?? "operation"} executed`;
  }
  if (eventKind === "failed") {
    return `${entry ?? context.commands[0] ?? "operation"} failed`;
  }
  if (eventKind === "policy.changed") {
    return context.data.policy ? `Policy ${String(context.data.policy)} changed` : `Policy source changed${file ? ` in ${file}` : ""}`;
  }
  if (eventKind === "proof.passed" || eventKind === "proof.failed") {
    return `${proofKind ?? "proof"} ${eventKind === "proof.passed" ? "passed" : "failed"}`;
  }
  if (eventKind === "diagnostic.emitted") {
    return `Diagnostic emitted${diagnostic ? `: ${diagnostic}` : ""}`;
  }
  if (eventKind === "git.exported") {
    return "Exported to Git";
  }
  if (eventKind === "agent.prompt.submitted") {
    return `${agentNameFromContext(context) ?? "Agent"} submitted a prompt`;
  }
  if (eventKind.startsWith("agent.tool")) {
    return `${agentNameFromContext(context) ?? "Agent"} ${String(context.data.toolName ?? context.commands[0] ?? "tool")} ${eventKind.split(".").pop()}`;
  }
  if (eventKind.startsWith("approval.")) {
    return `${agentNameFromContext(context) ?? "Agent"} approval ${eventKind.split(".").pop()}`;
  }
  if (eventKind.startsWith("agent.")) {
    return `${agentNameFromContext(context) ?? "Agent"} ${eventKind.replace(/^agent\./, "").replace(/\./g, " ")}`;
  }
  return context.summary ?? context.kind;
}

function semanticSeverity(eventKind: string): string {
  if (eventKind === "failed" || eventKind === "denied" || eventKind === "proof.failed" || eventKind.endsWith(".failed") || eventKind.endsWith(".denied")) {
    return "error";
  }
  if (eventKind === "proof.passed" || eventKind === "executed" || eventKind.endsWith(".completed")) {
    return "success";
  }
  if (eventKind === "policy.changed" || eventKind === "dependency.added" || eventKind === "dependency.upgraded") {
    return "warning";
  }
  return "info";
}

function confidenceForSemanticEvent(context: DeltaOperationContext, eventKind: string): number {
  if (eventKind === "modified" && context.fileClusters.some((cluster) => cluster.startsWith("file."))) {
    return 0.72;
  }
  if (eventKind === "policy.changed" && !context.data.policy) {
    return 0.78;
  }
  if (context.kind.startsWith("agent.") || context.kind.startsWith("approval.")) {
    const capture = context.data.capture && typeof context.data.capture === "object"
      ? context.data.capture as Record<string, unknown>
      : {};
    return typeof capture.confidence === "number" ? capture.confidence : 0.86;
  }
  return 0.95;
}

function timelineEntitiesFromContext(
  context: DeltaOperationContext,
  eventKind: string,
  runtimeRows: Record<string, unknown>[],
  proofRows: Record<string, unknown>[],
  fileRows: Record<string, unknown>[],
  artifactRows: Record<string, unknown>[],
): Array<Omit<DeltaSemanticTimelineEntity, "id" | "eventId">> {
  const entities: Array<Omit<DeltaSemanticTimelineEntity, "id" | "eventId">> = [];
  const add = (kind: string, name: unknown, role: string, confidence = 0.9) => {
    if (typeof name !== "string" || name.length === 0) {
      return;
    }
    const normalizedName = kind === "file" || kind === "manifest" ? normalizePath(name) : name;
    if (!entities.some((entity) => entity.kind === kind && entity.name === normalizedName && entity.role === role)) {
      entities.push({ kind, name: normalizedName, role, confidence });
    }
  };
  for (const entry of context.entries) {
    add("runtime-entry", entry, eventKind === "executed" || eventKind === "denied" || eventKind === "failed" ? "primary" : "affected", 0.95);
    add("agent-tool", entry, "affected", 0.7);
  }
  add("agent", agentNameFromContext(context), "source", 0.95);
  add("agent-tool", context.data.toolName, eventKind.startsWith("agent.tool") ? "primary" : "affected", 0.95);
  for (const service of context.services) {
    add("external-service", service, eventKind === "imported" ? "primary" : "source", 0.88);
  }
  for (const file of context.files) {
    add(file.endsWith(".manifest.json") || file === "forge.manifest.json" ? "manifest" : "file", file, eventKind === "generated" ? "generated" : "affected", 0.9);
  }
  for (const file of fileRows) {
    add("file", file.path, eventKind === "policy.changed" ? "source" : "affected", 0.95);
    for (const hint of parseSemanticHints(file.semantic_hints_json)) {
      if (hint.kind === "dependency.change") {
        add("dependency", stringOrUndefined(context.data.dependency) ?? stringOrUndefined(context.data.packageName), "affected", 0.65);
      }
      if (hint.kind === "policy.change") {
        add("policy", context.data.policy, eventKind === "policy.changed" ? "primary" : "affected", context.data.policy ? 0.86 : 0.55);
      }
    }
  }
  for (const artifact of artifactRows) {
    add("file", artifact.path, "generated", 0.86);
  }
  for (const runtime of runtimeRows) {
    add("runtime-entry", runtime.entry_name, "primary", 0.98);
    add("policy", runtime.policy, eventKind === "denied" ? "requires" : "affected", 0.9);
    add("diagnostic", runtime.diagnostic_code, eventKind === "denied" ? "failed" : "affected", 0.94);
    add("external-service", runtime.service, "source", 0.9);
  }
  for (const diagnostic of context.diagnostics) {
    add("diagnostic", diagnostic, eventKind === "denied" || eventKind === "failed" ? "failed" : "affected", 0.9);
  }
  for (const proof of proofRows) {
    add("proof", proof.proof_kind, eventKind === "proof.passed" ? "validated" : "failed", 0.98);
    for (const path of arrayOfStrings(parseJsonUnknown(proof.artifact_paths_json))) {
      add("file", path, "validated", 0.75);
    }
  }
  for (const proof of context.proofs) {
    add("proof", proof, eventKind === "proof.passed" ? "validated" : "failed", 0.9);
  }
  if (context.sessionId) {
    add("session", context.sessionId, "source", 0.75);
  }
  if (context.data.commitSha) {
    add("git-commit", context.data.commitSha, "exported", 0.85);
  }
  return entities.length > 0
    ? entities
    : [{ kind: "session", name: context.sessionId ?? context.id, role: "source", confidence: 0.5 }];
}

function agentNameFromContext(context: DeltaOperationContext): string | undefined {
  const source = context.data.source;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const agent = (source as Record<string, unknown>).agent;
    return typeof agent === "string" && agent.length > 0 ? agent : undefined;
  }
  return undefined;
}

function parseTimelineEntityTarget(target: string | undefined): DeltaTimelineEntityRef | undefined {
  if (!target) {
    return undefined;
  }
  const [prefix, ...tail] = target.split(":");
  if (tail.length > 0) {
    const name = tail.join(":");
    const kind = timelineEntityKindFromPrefix(prefix);
    return { kind, name: kind === "file" || kind === "manifest" ? normalizePath(name) : name };
  }
  if (target.includes("/") || target.startsWith(".") || hasKnownFileExtension(target)) {
    return { kind: "file", name: normalizePath(target) };
  }
  if (/^[A-Z0-9_]+$/.test(target)) {
    return { kind: "diagnostic", name: target };
  }
  return { kind: "runtime-entry", name: target };
}

function hasKnownFileExtension(target: string): boolean {
  return /\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sql|css|html|yml|yaml|toml|lock)$/i.test(target);
}

function timelineEntityKindFromPrefix(prefix: string): string {
  switch (prefix) {
    case "entry":
    case "runtime":
      return "runtime-entry";
    case "tool":
      return "agent-tool";
    case "service":
      return "external-service";
    case "commit":
    case "git":
      return "git-commit";
    default:
      return prefix;
  }
}

function normalizeSemanticKindFilter(kind: string): string[] {
  if (kind === "proof.run") {
    return ["proof.passed", "proof.failed"];
  }
  if (kind === "runtime.entry.executed") {
    return ["executed"];
  }
  if (kind === "runtime.entry.denied") {
    return ["denied"];
  }
  if (kind === "file.changed") {
    return ["modified", "policy.changed"];
  }
  return [kind];
}

function deterministicTimelineId(prefix: string, parts: string[]): string {
  return `${prefix}_${hashStable(parts.join("\0")).slice(0, 24)}`;
}

function summarizeTimelineArtifacts(artifacts: Record<string, unknown>[]): Record<string, unknown> | undefined {
  if (artifacts.length === 0) {
    return undefined;
  }
  const sample = artifacts.slice(0, 10).map((artifact) => ({
    path: artifact.path,
    artifactKind: artifact.artifact_kind,
    hash: artifact.hash,
    generated: artifact.generated,
  }));
  return {
    count: artifacts.length,
    hash: hashStable(JSON.stringify(artifacts.map((artifact) => ({
      path: artifact.path,
      artifactKind: artifact.artifact_kind,
      hash: artifact.hash,
      generated: artifact.generated,
    })))),
    sample,
    omitted: Math.max(0, artifacts.length - sample.length),
  };
}

function redactedTimelineData(data: Record<string, unknown>): Record<string, unknown> {
  const cleaned = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  return redactDeltaPayload(cleaned).value;
}

function rowToSemanticTimelineEvent(row: Record<string, unknown>): DeltaSemanticTimelineEvent {
  return {
    id: String(row.id),
    operationId: typeof row.operation_id === "string" ? row.operation_id : undefined,
    sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
    changeId: typeof row.change_id === "string" ? row.change_id : undefined,
    timestamp: String(row.timestamp),
    kind: String(row.event_kind),
    title: String(row.title),
    summary: typeof row.summary === "string" ? row.summary : undefined,
    severity: typeof row.severity === "string" ? row.severity : undefined,
    confidence: Number(row.confidence ?? 0),
    data: parseJsonRecord(row.data_json),
    entities: [],
  };
}

function rowToSemanticTimelineEntity(row: Record<string, unknown>): DeltaSemanticTimelineEntity {
  return {
    id: String(row.id),
    eventId: String(row.timeline_event_id),
    kind: String(row.entity_kind),
    name: String(row.entity_name),
    role: String(row.role),
    confidence: Number(row.confidence ?? 0),
  };
}

function rowToSemanticTimelineEdge(row: Record<string, unknown>): DeltaSemanticTimelineEdge {
  return {
    id: String(row.id),
    from: String(row.from_event_id),
    to: String(row.to_event_id),
    kind: String(row.edge_kind),
    confidence: Number(row.confidence ?? 0),
    reason: parseJsonRecord(row.reason_json),
  };
}

function hasSharedSemanticEntity(left: DeltaSemanticTimelineEntity[], right: DeltaSemanticTimelineEntity[]): boolean {
  return left.some((leftEntity) =>
    right.some((rightEntity) =>
      leftEntity.kind === rightEntity.kind &&
      leftEntity.name === rightEntity.name &&
      leftEntity.kind !== "session",
    ),
  );
}

function uniqueEdges(edges: DeltaSemanticTimelineEdge[]): DeltaSemanticTimelineEdge[] {
  const seen = new Set<string>();
  return edges.filter((edge) => {
    if (seen.has(edge.id)) {
      return false;
    }
    seen.add(edge.id);
    return true;
  });
}

function latestEventTimestamp(events: DeltaSemanticTimelineEvent[], kinds: string[]): string | undefined {
  return [...events].reverse().find((event) => kinds.includes(event.kind))?.timestamp;
}

function semanticOpenQuestions(
  entity: DeltaTimelineEntityRef | undefined,
  currentState: Record<string, unknown>,
  events: DeltaSemanticTimelineEvent[],
): string[] {
  const questions: string[] = [];
  if (entity && events.length === 0) {
    questions.push(`No semantic history found for ${entity.kind}:${entity.name}`);
  }
  if (entity?.kind === "runtime-entry" && currentState.exportedToGit === false) {
    questions.push("No Git export linked yet");
  }
  if (currentState.proofStatus === "stale") {
    questions.push("Proof is stale after the latest relevant change");
  }
  return questions;
}

function shouldInferWorkSession(context: DeltaOperationContext): boolean {
  return !context.kind.startsWith("session.") && context.kind !== "git.mapping.detected";
}

function scoreWorkSessionCandidate(
  context: DeltaOperationContext,
  candidate: DeltaWorkSessionSummary,
): { score: number; signals: DeltaWorkSessionSignal[] } {
  const signals: DeltaWorkSessionSignal[] = [];
  const metadata = candidate.metadata;
  addSignalIfOverlap(signals, "sameTraceId", 0.4, context.traces, metadata.traces);
  addSignalIfOverlap(signals, "sameManifestService", 0.35, context.services, metadata.services);
  addSignalIfOverlap(signals, "sameRuntimeEntry", 0.3, context.entries, metadata.entries);
  if (isDiagnosticRepairChain(context, metadata)) {
    signals.push({ signal: "diagnostic-repair", weight: 0.3, value: context.diagnostics[0] ?? metadata.diagnostics[0] });
  }
  if (context.proofs.length > 0 && hasAnyOverlap(context.entries, metadata.entries, context.files, metadata.files, context.services, metadata.services)) {
    signals.push({ signal: "proof-after-related-change", weight: 0.25, value: context.proofs[0] });
  }
  addSignalIfOverlap(signals, "sameFileCluster", 0.2, context.fileClusters, metadata.fileClusters);
  if (context.branch && candidate.gitBranch && context.branch === candidate.gitBranch) {
    signals.push({ signal: "same-branch", weight: 0.15, value: context.branch });
  } else if (context.branch && candidate.gitBranch && context.branch !== candidate.gitBranch) {
    signals.push({ signal: "branch-changed", weight: -0.3, value: `${candidate.gitBranch} -> ${context.branch}` });
  }
  if (context.actorId && metadata.actorIds.includes(context.actorId)) {
    signals.push({ signal: "same-actor", weight: 0.1, value: context.actorId });
  }
  const gapMinutes = metadata.lastOperationAt
    ? Math.abs(Date.parse(context.timestamp) - Date.parse(metadata.lastOperationAt)) / 60_000
    : Number.POSITIVE_INFINITY;
  if (gapMinutes < 10) {
    signals.push({ signal: "time-proximity", weight: 0.15, value: "<10m" });
  } else if (gapMinutes < 30) {
    signals.push({ signal: "time-proximity", weight: 0.1, value: "<30m" });
  } else if (gapMinutes > 120) {
    signals.push({ signal: "time-gap", weight: -0.3, value: ">2h" });
  }
  if (
    context.fileClusters.length > 0 &&
    metadata.fileClusters.length > 0 &&
    !intersects(context.fileClusters, metadata.fileClusters) &&
    !intersects(context.entries, metadata.entries) &&
    !intersects(context.services, metadata.services) &&
    !intersects(context.traces, metadata.traces)
  ) {
    signals.push({ signal: "unrelated-file-cluster", weight: -0.2, value: context.fileClusters[0] });
  }
  const score = roundConfidence(Math.max(0, Math.min(1, signals.reduce((total, signal) => total + signal.weight, 0))));
  return { score, signals };
}

function seedSignalsForContext(context: DeltaOperationContext): DeltaWorkSessionSignal[] {
  const signals: DeltaWorkSessionSignal[] = [{ signal: "session-seed", weight: 0.5, value: context.kind }];
  if (context.kind === "manifest.imported") {
    signals.push({ signal: "manifest-import-chain", weight: 0.35, value: context.services[0] ?? context.summary });
  }
  if (context.entries[0]) {
    signals.push({ signal: "sameRuntimeEntry", weight: 0.3, value: context.entries[0] });
  }
  if (context.fileClusters[0]) {
    signals.push({ signal: "sameFileCluster", weight: 0.2, value: context.fileClusters[0] });
  }
  if (context.branch) {
    signals.push({ signal: "same-branch", weight: 0.15, value: context.branch });
  }
  return signals;
}

function addSignalIfOverlap(
  signals: DeltaWorkSessionSignal[],
  signal: string,
  weight: number,
  left: string[],
  right: string[],
): void {
  const value = left.find((item) => right.includes(item));
  if (value) {
    signals.push({ signal, weight, value });
  }
}

function contextToWorkSessionMetadata(context: DeltaOperationContext): DeltaWorkSessionMetadata {
  return {
    files: context.files,
    fileClusters: context.fileClusters,
    entries: context.entries,
    diagnostics: context.diagnostics,
    proofs: context.proofs,
    services: context.services,
    traces: context.traces,
    commands: context.commands,
    operationKinds: [context.kind],
    actorIds: uniqueStrings([context.actorId]),
    lastOperationAt: context.timestamp,
  };
}

function emptyWorkSessionMetadata(): DeltaWorkSessionMetadata {
  return {
    files: [],
    fileClusters: [],
    entries: [],
    diagnostics: [],
    proofs: [],
    services: [],
    traces: [],
    commands: [],
    operationKinds: [],
    actorIds: [],
  };
}

function mergeWorkSessionMetadata(left: DeltaWorkSessionMetadata, right: DeltaWorkSessionMetadata): DeltaWorkSessionMetadata {
  return {
    files: capStrings(uniqueStrings([...left.files, ...right.files]), 50),
    fileClusters: capStrings(uniqueStrings([...left.fileClusters, ...right.fileClusters]), 30),
    entries: capStrings(uniqueStrings([...left.entries, ...right.entries]), 50),
    diagnostics: capStrings(uniqueStrings([...left.diagnostics, ...right.diagnostics]), 30),
    proofs: capStrings(uniqueStrings([...left.proofs, ...right.proofs]), 30),
    services: capStrings(uniqueStrings([...left.services, ...right.services]), 30),
    traces: capStrings(uniqueStrings([...left.traces, ...right.traces]), 30),
    commands: capStrings(uniqueStrings([...left.commands, ...right.commands]), 30),
    operationKinds: capStrings(uniqueStrings([...left.operationKinds, ...right.operationKinds]), 50),
    actorIds: capStrings(uniqueStrings([...left.actorIds, ...right.actorIds]), 30),
    lastOperationAt: maxIso(left.lastOperationAt, right.lastOperationAt),
    mergedFrom: capStrings(uniqueStrings([...(left.mergedFrom ?? []), ...(right.mergedFrom ?? [])]), 20),
    splitFrom: left.splitFrom ?? right.splitFrom,
    manualTitle: left.manualTitle || right.manualTitle || undefined,
  };
}

function normalizeWorkSessionMetadata(value: Record<string, unknown>): DeltaWorkSessionMetadata {
  return {
    files: arrayOfStrings(value.files),
    fileClusters: arrayOfStrings(value.fileClusters),
    entries: arrayOfStrings(value.entries),
    diagnostics: arrayOfStrings(value.diagnostics),
    proofs: arrayOfStrings(value.proofs),
    services: arrayOfStrings(value.services),
    traces: arrayOfStrings(value.traces),
    commands: arrayOfStrings(value.commands),
    operationKinds: arrayOfStrings(value.operationKinds),
    actorIds: arrayOfStrings(value.actorIds),
    lastOperationAt: stringOrUndefined(value.lastOperationAt),
    mergedFrom: arrayOfStrings(value.mergedFrom),
    splitFrom: stringOrUndefined(value.splitFrom),
    manualTitle: value.manualTitle === true,
  };
}

function inferWorkSessionTitle(context: DeltaOperationContext, metadata: DeltaWorkSessionMetadata): string {
  if (context.kind === "manifest.imported" && metadata.services[0]) {
    return `Import ${metadata.services[0]} external service`;
  }
  if (metadata.diagnostics[0] && metadata.entries[0]) {
    return `Fix ${metadata.diagnostics[0]} for ${metadata.entries[0]}`;
  }
  if (metadata.entries[0]) {
    return `${context.kind.includes("failed") ? "Repair" : "Update"} ${metadata.entries[0]}`;
  }
  if (metadata.proofs[0]) {
    return `Validate ${metadata.proofs[0]}`;
  }
  if (metadata.fileClusters.includes("policy.change")) {
    return "Update policies";
  }
  if (metadata.files.length > 1) {
    return "Update files and artifacts";
  }
  if (metadata.files[0]) {
    return `Update ${metadata.files[0]}`;
  }
  if (metadata.commands[0]) {
    return metadata.commands[0];
  }
  return `Work session ${context.timestamp.slice(0, 16).replace("T", " ")}`;
}

function inferIntent(context: DeltaOperationContext, metadata: DeltaWorkSessionMetadata): string {
  if (context.kind === "manifest.imported" || metadata.fileClusters.includes("manifest.change")) {
    return "external-runtime-import";
  }
  if (metadata.diagnostics.length > 0) {
    return "diagnostic-repair";
  }
  if (metadata.proofs.length > 0) {
    return "proof-validation";
  }
  if (metadata.entries.length > 0) {
    return "runtime-entry-work";
  }
  if (metadata.fileClusters.some((cluster) => cluster.endsWith(".change"))) {
    return "source-change";
  }
  return "general-work";
}

function summarizeWorkSession(metadata: DeltaWorkSessionMetadata): string {
  const parts: string[] = [];
  if (metadata.services[0]) {
    parts.push(`worked on ${metadata.services[0]}`);
  }
  if (metadata.entries.length > 0) {
    parts.push(`touched ${metadata.entries.slice(0, 3).join(", ")}`);
  }
  if (metadata.files.length > 0) {
    parts.push(`changed ${metadata.files.slice(0, 3).join(", ")}`);
  }
  if (metadata.diagnostics.length > 0) {
    parts.push(`observed ${metadata.diagnostics.slice(0, 3).join(", ")}`);
  }
  if (metadata.proofs.length > 0) {
    parts.push(`ran ${metadata.proofs.slice(0, 3).join(", ")}`);
  }
  return parts.length === 0 ? "Recorded a Forge work session." : `Session ${parts.join("; ")}.`;
}

function initialWorkSessionConfidence(context: DeltaOperationContext): number {
  if (context.kind === "manifest.imported") {
    return 0.78;
  }
  if (context.entries.length > 0) {
    return 0.72;
  }
  if (context.proofs.length > 0 || context.kind === "proof.run") {
    return 0.7;
  }
  if (context.files.length > 1) {
    return 0.68;
  }
  if (context.files.length > 0) {
    return 0.62;
  }
  return 0.55;
}

function isDiagnosticRepairChain(context: DeltaOperationContext, metadata: DeltaWorkSessionMetadata): boolean {
  return (
    (context.diagnostics.length > 0 && metadata.fileClusters.some((cluster) => cluster.includes("policy") || cluster.includes("command") || cluster.includes("query"))) ||
    (metadata.diagnostics.length > 0 && context.fileClusters.some((cluster) => cluster.includes("policy") || cluster.includes("command") || cluster.includes("query")))
  );
}

function hasAnyOverlap(...groups: string[][]): boolean {
  for (let index = 0; index < groups.length; index += 2) {
    if (intersects(groups[index] ?? [], groups[index + 1] ?? [])) {
      return true;
    }
  }
  return false;
}

function intersects(left: string[], right: string[]): boolean {
  return left.some((item) => right.includes(item));
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function capStrings(values: string[], limit: number): string[] {
  return values.slice(0, limit);
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value) : [];
}

function maxIso(left?: string, right?: string): string | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return Date.parse(left) >= Date.parse(right) ? left : right;
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseSemanticHints(value: unknown): DeltaSemanticHint[] {
  const parsed = typeof value === "string" ? safeJson<unknown>(value || "[]", []) : value;
  return Array.isArray(parsed)
    ? parsed.filter((item): item is DeltaSemanticHint => Boolean(item) && typeof item === "object" && "kind" in item)
    : [];
}

function diagnosticCodesFromJson(value: unknown): string[] {
  const parsed = typeof value === "string" ? safeJson(value, []) : value;
  if (!Array.isArray(parsed)) {
    return [];
  }
  return uniqueStrings(parsed.map((item) => item && typeof item === "object" && "code" in item ? (item as { code?: unknown }).code : undefined));
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseJsonUnknown(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function clusterForPath(path: string): string {
  return classifyDeltaPath(path)[0]?.kind ?? "file.unknown";
}

function serviceFromManifestPath(path: string): string | undefined {
  const normalized = normalizePath(path);
  const fileName = normalized.split("/").pop() ?? "";
  return fileName.endsWith(".manifest.json") ? fileName.replace(/\.manifest\.json$/, "") : undefined;
}

function normalizeWorkSessionKind(value: unknown): DeltaWorkSessionKind {
  return value === "agent" || value === "human" || value === "ci" || value === "git" || value === "manual-corrected" ? value : "auto";
}

function normalizeWorkSessionStatus(value: unknown): DeltaWorkSessionStatus {
  return value === "idle" || value === "closed" || value === "merged" || value === "split" || value === "needs-review" ? value : "open";
}

function rowToTimelineEntry(row: Record<string, unknown>): DeltaTimelineEntry {
  return {
    id: String(row.id),
    kind: String(row.kind),
    timestamp: String(row.timestamp),
    summary: typeof row.summary === "string" ? row.summary : undefined,
    data: parseJsonRecord(row.data_json),
  };
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      typeof value === "string" && (key.endsWith("_json") || key === "data_json")
        ? parseJsonRecord(value)
        : value,
    ]),
  );
}
