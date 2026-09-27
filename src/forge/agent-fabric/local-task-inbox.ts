import type { DbAdapter } from "../runtime/db/adapter.ts";
import { AgentFabricError } from "./errors.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import type { LocalPatchEvidence } from "./local-coding-worker.ts";
import type { LocalVerificationEvidence } from "./local-verification.ts";
import {
  validateLocalCodingTaskProposal,
  type ValidatedLocalCodingTaskProposal,
} from "./local-task-contract.ts";
import type { Digest } from "./types.ts";

const CREATE_TASKS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_tasks (
    task_id TEXT PRIMARY KEY,
    repository_root TEXT NOT NULL,
    proposal_digest TEXT NOT NULL UNIQUE,
    proposal_json TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('proposed', 'rejected')),
    created_at BIGINT NOT NULL,
    decided_at BIGINT
  )`;

const CREATE_PATCHES_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_patches (
    task_id TEXT PRIMARY KEY,
    evidence_json TEXT NOT NULL
  )`;

const CREATE_DECISIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_patch_decisions (
    task_id TEXT PRIMARY KEY,
    diff_digest TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
    decided_at BIGINT NOT NULL
  )`;

const CREATE_VERIFICATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_verifications (
    task_id TEXT PRIMARY KEY,
    diff_digest TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'finished')),
    evidence_json TEXT,
    evidence_digest TEXT
  )`;

const CREATE_MATERIALIZATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_materializations (
    task_id TEXT PRIMARY KEY,
    result_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('started', 'receipted')),
    diff_digest TEXT
  )`;

export interface LocalMaterializationRecord {
  resultDigest: Digest;
  state: "started" | "receipted";
  diffDigest?: Digest;
}

export interface LocalVerificationRecord {
  diffDigest: Digest;
  requestDigest: Digest;
  state: "started" | "finished";
  evidence?: LocalVerificationEvidence;
  evidenceDigest?: Digest;
}

export interface LocalTaskRecord extends ValidatedLocalCodingTaskProposal {
  taskId: string;
  repositoryRoot: string;
  state: "proposed" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}

function taskIdFor(digest: Digest): string {
  return `task:${digest.slice("sha256:".length)}`;
}

export class LocalTaskInbox {
  private schemaReady?: Promise<unknown>;
  private patchSchemaReady?: Promise<unknown>;
  private decisionSchemaReady?: Promise<unknown>;
  private verificationSchemaReady?: Promise<unknown>;
  private materializationSchemaReady?: Promise<unknown>;

  constructor(private readonly adapter: DbAdapter) {
    if (adapter.kind !== "pglite") {
      throw new AgentFabricError("AF_INVALID_STATE", "Local task inbox requires PGlite");
    }
  }

  private async ready(): Promise<void> {
    this.schemaReady ??= this.adapter.query(CREATE_TASKS_TABLE);
    await this.schemaReady;
  }

  async propose(
    input: unknown,
    repositoryRoot: string,
    now = Date.now(),
  ): Promise<LocalTaskRecord> {
    const validated = validateLocalCodingTaskProposal(input);
    if (validated.proposal.limits.expiresAt <= now) {
      throw new AgentFabricError("AF_INVALID_STATE", "Local coding task has expired");
    }
    const taskId = taskIdFor(validated.proposalDigest);
    await this.ready();
    await this.adapter.query(
      `INSERT INTO _forge_agent_fabric_local_tasks
       (task_id, repository_root, proposal_digest, proposal_json, state, created_at)
       VALUES ($1, $2, $3, $4, 'proposed', $5)
       ON CONFLICT (task_id) DO NOTHING`,
      [taskId, repositoryRoot, validated.proposalDigest,
        JSON.stringify(validated.proposal), now],
    );
    const record = await this.get(taskId);
    if (!record || record.repositoryRoot !== repositoryRoot ||
        record.proposalDigest !== validated.proposalDigest) {
      throw new AgentFabricError("AF_CONFLICT", "Task identity is already bound to another repository or revision");
    }
    return record;
  }

  async get(taskId: string): Promise<LocalTaskRecord | null> {
    if (!/^task:[0-9a-f]{64}$/u.test(taskId)) {
      throw new AgentFabricError("AF_INVALID_STATE", "Invalid local task identity");
    }
    await this.ready();
    const result = await this.adapter.query(
      `SELECT task_id, repository_root, proposal_digest, proposal_json, state, created_at, decided_at
       FROM _forge_agent_fabric_local_tasks WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(row.proposal_json));
    } catch {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored task proposal is not JSON");
    }
    const validated = validateLocalCodingTaskProposal(parsed);
    if (row.task_id !== taskId || row.proposal_digest !== validated.proposalDigest ||
        taskIdFor(validated.proposalDigest) !== taskId ||
        (row.state !== "proposed" && row.state !== "rejected") ||
        typeof row.repository_root !== "string" || !row.repository_root) {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored task proposal is inconsistent");
    }
    return {
      taskId,
      repositoryRoot: row.repository_root,
      ...validated,
      state: row.state,
      createdAt: Number(row.created_at),
      decidedAt: row.decided_at === null ? null : Number(row.decided_at),
    };
  }

  async reject(taskId: string, expectedDigest: Digest, now = Date.now()): Promise<void> {
    await this.ready();
    const result = await this.adapter.query(
      `UPDATE _forge_agent_fabric_local_tasks SET state = 'rejected', decided_at = $3
       WHERE task_id = $1 AND proposal_digest = $2 AND state = 'proposed'`,
      [taskId, expectedDigest, now],
    );
    if (result.rowCount !== 1) {
      throw new AgentFabricError("AF_CONFLICT", "Task is stale or already reviewed");
    }
  }

  async recordPatch(taskId: string, evidence: LocalPatchEvidence): Promise<void> {
    await this.ready();
    this.patchSchemaReady ??= this.adapter.query(CREATE_PATCHES_TABLE);
    await this.patchSchemaReady;
    const encoded = stableStringify(evidence);
    await this.adapter.query(
      `INSERT INTO _forge_agent_fabric_local_patches (task_id, evidence_json)
       VALUES ($1, $2) ON CONFLICT (task_id) DO NOTHING`,
      [taskId, encoded],
    );
    const stored = await this.getPatch(taskId);
    if (!stored || stableStringify(stored) !== encoded) {
      throw new AgentFabricError("AF_CONFLICT", "Task already has different patch evidence");
    }
  }

  async getPatch(taskId: string): Promise<LocalPatchEvidence | null> {
    this.patchSchemaReady ??= this.adapter.query(CREATE_PATCHES_TABLE);
    await this.patchSchemaReady;
    const result = await this.adapter.query(
      `SELECT evidence_json FROM _forge_agent_fabric_local_patches WHERE task_id = $1`,
      [taskId],
    );
    const encoded = result.rows[0]?.evidence_json;
    if (typeof encoded !== "string") return null;
    try {
      return JSON.parse(encoded) as LocalPatchEvidence;
    } catch {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored patch evidence is not JSON");
    }
  }

  async beginMaterialization(taskId: string, resultDigest: Digest): Promise<void> {
    this.materializationSchemaReady ??= this.adapter.query(CREATE_MATERIALIZATIONS_TABLE);
    await this.materializationSchemaReady;
    const inserted = await this.adapter.query(
      `INSERT INTO _forge_agent_fabric_local_materializations
       (task_id, result_digest, state) VALUES ($1, $2, 'started')
       ON CONFLICT (task_id) DO NOTHING`, [taskId, resultDigest],
    );
    if (inserted.rowCount !== 1) {
      throw new AgentFabricError("AF_CONFLICT", "Patch materialization already started; reconcile its receipt before retrying");
    }
  }

  async receiptMaterialization(taskId: string, resultDigest: Digest, diffDigest: Digest): Promise<void> {
    const patch = await this.getPatch(taskId);
    if (!patch || patch.diffDigest !== diffDigest) {
      throw new AgentFabricError("AF_CONFLICT", "Materialization receipt has no matching patch readback");
    }
    const updated = await this.adapter.query(
      `UPDATE _forge_agent_fabric_local_materializations SET state = 'receipted', diff_digest = $3
       WHERE task_id = $1 AND result_digest = $2 AND state = 'started'`,
      [taskId, resultDigest, diffDigest],
    );
    if (updated.rowCount !== 1) throw new AgentFabricError("AF_CONFLICT", "Materialization receipt was already recorded or changed");
  }

  async getMaterialization(taskId: string): Promise<LocalMaterializationRecord | null> {
    this.materializationSchemaReady ??= this.adapter.query(CREATE_MATERIALIZATIONS_TABLE);
    await this.materializationSchemaReady;
    const result = await this.adapter.query(
      `SELECT result_digest, state, diff_digest FROM _forge_agent_fabric_local_materializations WHERE task_id = $1`,
      [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (typeof row.result_digest !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(row.result_digest) ||
        (row.state !== "started" && row.state !== "receipted") ||
        (row.state === "started" && row.diff_digest !== null) ||
        (row.state === "receipted" && (typeof row.diff_digest !== "string" ||
          !/^sha256:[0-9a-f]{64}$/u.test(row.diff_digest)))) {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored patch materialization is inconsistent");
    }
    return { resultDigest: row.result_digest as Digest, state: row.state,
      ...(row.state === "receipted" ? { diffDigest: row.diff_digest as Digest } : {}) };
  }

  async beginVerification(taskId: string, diffDigest: Digest, requestDigest: Digest): Promise<void> {
    const patch = await this.getPatch(taskId);
    if (!patch || patch.diffDigest !== diffDigest) {
      throw new AgentFabricError("AF_CONFLICT", "Verification patch changed");
    }
    this.verificationSchemaReady ??= this.adapter.query(CREATE_VERIFICATIONS_TABLE);
    await this.verificationSchemaReady;
    const result = await this.adapter.query(
      `INSERT INTO _forge_agent_fabric_local_verifications
       (task_id, diff_digest, request_digest, state) VALUES ($1, $2, $3, 'started')
       ON CONFLICT (task_id) DO NOTHING`, [taskId, diffDigest, requestDigest],
    );
    if (result.rowCount !== 1) {
      throw new AgentFabricError("AF_CONFLICT", "Verification already dispatched; read back its result or reconcile uncertain execution");
    }
  }

  async finishVerification(taskId: string, evidence: LocalVerificationEvidence, requestDigest: Digest): Promise<void> {
    const evidenceDigest = digestCanonical(evidence, sha256Digest);
    const result = await this.adapter.query(
      `UPDATE _forge_agent_fabric_local_verifications SET state = 'finished',
       evidence_json = $4, evidence_digest = $5
       WHERE task_id = $1 AND diff_digest = $2 AND request_digest = $3 AND state = 'started'`,
      [taskId, evidence.patchDigest, requestDigest, stableStringify(evidence), evidenceDigest],
    );
    if (result.rowCount !== 1) throw new AgentFabricError("AF_CONFLICT", "Verification intent changed before result commit");
  }

  async getVerification(taskId: string): Promise<LocalVerificationRecord | null> {
    this.verificationSchemaReady ??= this.adapter.query(CREATE_VERIFICATIONS_TABLE);
    await this.verificationSchemaReady;
    const result = await this.adapter.query(
      `SELECT diff_digest, request_digest, state, evidence_json, evidence_digest
       FROM _forge_agent_fabric_local_verifications WHERE task_id = $1`, [taskId],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (typeof row.diff_digest !== "string" || typeof row.request_digest !== "string" ||
        (row.state !== "started" && row.state !== "finished")) {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored verification intent is invalid");
    }
    if (row.state === "started") {
      if (row.evidence_json !== null || row.evidence_digest !== null) throw new AgentFabricError("AF_INVALID_STATE", "Started verification has a result");
      return { diffDigest: row.diff_digest as Digest, requestDigest: row.request_digest as Digest, state: "started" };
    }
    let evidence: LocalVerificationEvidence;
    try { evidence = JSON.parse(String(row.evidence_json)) as LocalVerificationEvidence; }
    catch { throw new AgentFabricError("AF_INVALID_STATE", "Stored verification result is not JSON"); }
    if (evidence.patchDigest !== row.diff_digest || digestCanonical(evidence, sha256Digest) !== row.evidence_digest) {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored verification result failed digest readback");
    }
    return { diffDigest: row.diff_digest as Digest, requestDigest: row.request_digest as Digest,
      state: "finished", evidence, evidenceDigest: row.evidence_digest as Digest };
  }

  async recordPatchDecision(taskId: string, diffDigest: Digest, decision: "approved" | "rejected", now = Date.now()): Promise<void> {
    const patch = await this.getPatch(taskId);
    if (!patch || patch.diffDigest !== diffDigest) {
      throw new AgentFabricError("AF_CONFLICT", "Patch review does not match the recorded diff");
    }
    this.decisionSchemaReady ??= this.adapter.query(CREATE_DECISIONS_TABLE);
    await this.decisionSchemaReady;
    const result = await this.adapter.query(
      `INSERT INTO _forge_agent_fabric_local_patch_decisions (task_id, diff_digest, decision, decided_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (task_id) DO NOTHING`,
      [taskId, diffDigest, decision, now],
    );
    if (result.rowCount !== 1) {
      throw new AgentFabricError("AF_CONFLICT", "Patch already has an owner decision");
    }
  }

  async getPatchDecision(taskId: string): Promise<"approved" | "rejected" | null> {
    this.decisionSchemaReady ??= this.adapter.query(CREATE_DECISIONS_TABLE);
    await this.decisionSchemaReady;
    const result = await this.adapter.query(
      `SELECT decision FROM _forge_agent_fabric_local_patch_decisions WHERE task_id = $1`,
      [taskId],
    );
    const decision = result.rows[0]?.decision;
    if (decision === "approved" || decision === "rejected") return decision;
    if (decision === undefined) return null;
    throw new AgentFabricError("AF_INVALID_STATE", "Stored patch decision is invalid");
  }
}
