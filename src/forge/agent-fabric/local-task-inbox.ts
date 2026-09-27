import type { DbAdapter } from "../runtime/db/adapter.ts";
import { AgentFabricError } from "./errors.ts";
import { stableStringify } from "./canonical.ts";
import type { LocalPatchEvidence } from "./local-coding-worker.ts";
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
