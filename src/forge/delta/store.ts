import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { createPgliteAdapter } from "../runtime/db/pglite-adapter.ts";
import type { DbAdapter } from "../runtime/db/adapter.ts";
import { hashStable, hashUtf8Bytes } from "../compiler/primitives/hash.ts";
import { normalizePath } from "../compiler/primitives/paths.ts";
import { DELTA_SCHEMA_SQL, DELTA_SCHEMA_VERSION } from "./schema.ts";
import { createDeltaId } from "./ids.ts";
import { redactDeltaPayload } from "./redaction.ts";
import { classifyArtifactKind, classifyDeltaPath, type DeltaSemanticHint } from "./classifier.ts";
import { readDeltaGitSnapshot, type DeltaGitSnapshot } from "./git-observer.ts";

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

export interface DeltaStatus {
  ok: true;
  recording: boolean;
  store: string;
  session?: {
    id: string;
    startedAt: string;
    operationCount: number;
  };
  workSession?: DeltaWorkSessionSummary;
  recentOperations: Array<{ id: string; kind: string; summary?: string; timestamp: string }>;
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

export class DeltaStore {
  private constructor(
    readonly workspaceRoot: string,
    readonly storePath: string,
    private readonly adapter: DbAdapter,
  ) {}

  static async open(workspaceRoot: string): Promise<DeltaStore> {
    const storePath = getDeltaStorePath(workspaceRoot);
    mkdirSync(dirname(storePath), { recursive: true });
    const adapter = await createPgliteAdapter(storePath);
    const store = new DeltaStore(workspaceRoot, storePath, adapter);
    await store.init();
    return store;
  }

  async close(): Promise<void> {
    await this.adapter.close();
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
      type,
      origin: manifestOps.rows.map((row) => parseJsonRecord(row.data_json)),
      runtime: latestRuntime ? normalizeRow(latestRuntime) : null,
      files: files.rows.map(normalizeRow),
      artifacts: artifacts.rows.map(normalizeRow),
      proofs: proofs.rows.map(normalizeRow),
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
      `INSERT INTO runtime_calls (id, operation_id, entry_name, entry_kind, risk, policy, tenant_scoped, result, diagnostic_code, trace_id, service, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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

  private async latestGitMapping(): Promise<Record<string, unknown> | null> {
    const result = await this.adapter.query(`SELECT * FROM git_mappings ORDER BY detected_at DESC LIMIT 1`);
    return result.rows[0] ? normalizeRow(result.rows[0]) : null;
  }
}

export function getDeltaStorePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".forge", "delta", "delta.db");
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
