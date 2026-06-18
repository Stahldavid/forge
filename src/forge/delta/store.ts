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
  recentOperations: Array<{ id: string; kind: string; summary?: string; timestamp: string }>;
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
