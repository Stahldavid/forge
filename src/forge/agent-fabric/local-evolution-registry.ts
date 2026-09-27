import { randomUUID } from "node:crypto";
import type { DbAdapter, DbTransaction } from "../runtime/db/adapter.ts";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { Digest } from "./types.ts";

/** A candidate is data. This registry never loads or executes its artifact. */
export interface ExtensionCandidate {
  extensionKey: string;
  artifactDigest: Digest;
  manifestDigest: Digest;
}

export interface ExtensionVersion extends ExtensionCandidate {
  versionId: string;
  registeredAt: number;
}

export interface FixedEvaluationSuite {
  suiteId: string;
  suiteDigest: Digest;
  caseIds: readonly string[];
}

export interface EvaluationCaseEvidence {
  caseId: string;
  passed: boolean;
  evidenceDigest: Digest;
}

export interface EvaluationRecord {
  versionId: string;
  suiteId: string;
  suiteDigest: Digest;
  state: "running" | "passed" | "failed" | "inconclusive";
  cases: readonly EvaluationCaseEvidence[];
  evidenceDigest: Digest | null;
}

export type EvolutionDecisionAction = "canary" | "promote" | "rollback" | "revoke";
export type EvolutionChannel = "canary" | "stable";

export interface OwnerDecisionChallenge {
  decisionNonce: string;
  action: EvolutionDecisionAction;
  versionId: string;
  extensionKey: string;
  expectedSelection: string | null;
  evaluationDigest: Digest | null;
}

/** Must be backed by trusted owner ingress, separate from CLI/MCP/model input. */
export interface EvolutionOwnerVerifier {
  verify(challenge: Readonly<OwnerDecisionChallenge>): Promise<{
    verifierId: string;
    challengeDigest: Digest;
    evidenceDigest: Digest;
  }>;
}

export interface EvolutionRegistryOptions {
  adapter: DbAdapter;
  suite: FixedEvaluationSuite;
  evaluator: (version: Readonly<ExtensionVersion>, suite: Readonly<FixedEvaluationSuite>) => Promise<readonly EvaluationCaseEvidence[]>;
  ownerVerifier: EvolutionOwnerVerifier;
  now?: () => number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const KEY = /^[a-z][a-z0-9._-]{0,63}$/u;
const VERSION = /^extension:sha256:[0-9a-f]{64}$/u;
const ATTEMPT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;

function invalid(message: string): never { throw new AgentFabricError("AF_INVALID_STATE", message); }
function conflict(message: string): never { throw new AgentFabricError("AF_CONFLICT", message); }
function validDigest(value: unknown): value is Digest { return typeof value === "string" && DIGEST.test(value); }
function validTime(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function versionIdFor(candidate: ExtensionCandidate): string {
  return `extension:${digestCanonical(candidate, sha256Digest)}`;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_versions (
    version_id TEXT PRIMARY KEY, extension_key TEXT NOT NULL,
    artifact_digest TEXT NOT NULL, manifest_digest TEXT NOT NULL,
    registered_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_evaluations (
    version_id TEXT PRIMARY KEY, suite_id TEXT NOT NULL, suite_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('running','passed','failed','inconclusive')),
    cases_json TEXT NOT NULL, evidence_digest TEXT)`,
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_decisions (
    decision_sequence BIGSERIAL PRIMARY KEY, version_id TEXT NOT NULL,
    extension_key TEXT NOT NULL, action TEXT NOT NULL,
    challenge_digest TEXT NOT NULL, owner_evidence_digest TEXT NOT NULL,
    verifier_id TEXT NOT NULL, decided_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_selections (
    extension_key TEXT NOT NULL, channel TEXT NOT NULL,
    version_id TEXT, PRIMARY KEY (extension_key, channel))`,
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_revocations (
    version_id TEXT PRIMARY KEY, decided_at BIGINT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS _forge_fabric_extension_attempts (
    attempt_id TEXT PRIMARY KEY, version_id TEXT NOT NULL,
    extension_key TEXT NOT NULL, channel TEXT NOT NULL, bound_at BIGINT NOT NULL)`,
] as const;

/** Serialized single-owner PGlite registry. All state mutations commit before acknowledgement. */
export class LocalEvolutionRegistry {
  private schemaReady?: Promise<void>;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly suite: FixedEvaluationSuite;

  constructor(private readonly options: EvolutionRegistryOptions) {
    if (options.adapter.kind !== "pglite") invalid("Evolution registry requires local PGlite");
    const suite = structuredClone(options.suite);
    if (!KEY.test(suite.suiteId) || !validDigest(suite.suiteDigest) ||
        suite.caseIds.length === 0 || suite.caseIds.length > 64 ||
        new Set(suite.caseIds).size !== suite.caseIds.length ||
        suite.caseIds.some((id) => !KEY.test(id)) ||
        suite.suiteDigest !== digestCanonical({ suiteId: suite.suiteId, caseIds: suite.caseIds }, sha256Digest)) {
      invalid("Invalid fixed evaluation suite");
    }
    this.suite = suite;
    this.now = options.now ?? Date.now;
  }

  private async ready(): Promise<void> {
    this.schemaReady ??= (async () => {
      for (const statement of SCHEMA) await this.options.adapter.query(statement);
    })();
    await this.schemaReady;
  }

  private async serialized<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { await this.ready(); return await fn(); } finally { release(); }
  }

  private async transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    const tx = await this.options.adapter.begin();
    try {
      const result = await fn(tx);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

  async register(candidate: ExtensionCandidate): Promise<ExtensionVersion> {
    if (!candidate || !KEY.test(candidate.extensionKey) || !validDigest(candidate.artifactDigest) ||
        !validDigest(candidate.manifestDigest)) invalid("Invalid extension candidate");
    const exactCandidate: ExtensionCandidate = {
      extensionKey: candidate.extensionKey,
      artifactDigest: candidate.artifactDigest,
      manifestDigest: candidate.manifestDigest,
    };
    const versionId = versionIdFor(exactCandidate);
    const registeredAt = this.now();
    if (!validTime(registeredAt)) invalid("Invalid registry time");
    return this.serialized(async () => {
      await this.options.adapter.query(
        `INSERT INTO _forge_fabric_extension_versions
         (version_id, extension_key, artifact_digest, manifest_digest, registered_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (version_id) DO NOTHING`,
        [versionId, exactCandidate.extensionKey, exactCandidate.artifactDigest,
          exactCandidate.manifestDigest, registeredAt],
      );
      return (await this.getVersion(versionId))!;
    });
  }

  async getVersion(versionId: string): Promise<ExtensionVersion | null> {
    if (!VERSION.test(versionId)) invalid("Invalid extension version ID");
    await this.ready();
    const rows = (await this.options.adapter.query(
      `SELECT version_id, extension_key, artifact_digest, manifest_digest, registered_at
       FROM _forge_fabric_extension_versions WHERE version_id=$1`, [versionId],
    )).rows;
    const row = rows[0];
    if (!row) return null;
    const candidate = {
      extensionKey: row.extension_key as string,
      artifactDigest: row.artifact_digest as Digest,
      manifestDigest: row.manifest_digest as Digest,
    };
    const registeredAt = Number(row.registered_at);
    if (!KEY.test(candidate.extensionKey) || !validDigest(candidate.artifactDigest) ||
        !validDigest(candidate.manifestDigest) || !validTime(registeredAt) ||
        versionIdFor(candidate) !== row.version_id) invalid("Stored extension version is inconsistent");
    return { ...candidate, versionId, registeredAt };
  }

  async evaluate(versionId: string): Promise<EvaluationRecord> {
    const version = await this.getVersion(versionId);
    if (!version) throw new AgentFabricError("AF_NOT_FOUND", "Extension version not found");
    const suite = this.suite;
    await this.serialized(async () => {
      await this.transaction(async (tx) => {
        const existing = (await tx.query(
          `SELECT version_id FROM _forge_fabric_extension_evaluations WHERE version_id=$1`, [versionId],
        )).rows[0];
        if (existing) conflict("Extension evaluation already started");
        await tx.query(
          `INSERT INTO _forge_fabric_extension_evaluations
           (version_id,suite_id,suite_digest,state,cases_json,evidence_digest)
           VALUES ($1,$2,$3,'running','[]',NULL)`, [versionId, suite.suiteId, suite.suiteDigest],
        );
      });
    });
    let cases: readonly EvaluationCaseEvidence[] = [];
    let state: EvaluationRecord["state"] = "inconclusive";
    try {
      const result = await this.options.evaluator(structuredClone(version), structuredClone(suite));
      if (result.length !== suite.caseIds.length || result.length > 64 ||
          result.some((item, index) => !item || item.caseId !== suite.caseIds[index] ||
            typeof item.passed !== "boolean" || !validDigest(item.evidenceDigest))) {
        invalid("Evaluator returned evidence outside the fixed suite");
      }
      cases = structuredClone(result);
      state = cases.every((item) => item.passed) ? "passed" : "failed";
    } catch {
      // An evaluator error is not evidence of a failed case. It remains inconclusive.
    }
    const evidenceDigest = state === "inconclusive" ? null : digestCanonical(
      { versionId, suiteId: suite.suiteId, suiteDigest: suite.suiteDigest, cases }, sha256Digest,
    );
    await this.serialized(async () => {
      const update = await this.options.adapter.query(
        `UPDATE _forge_fabric_extension_evaluations
         SET state=$2,cases_json=$3,evidence_digest=$4
         WHERE version_id=$1 AND state='running'`,
        [versionId, state, stableStringify(cases), evidenceDigest],
      );
      if (update.rowCount !== 1) conflict("Evaluation state changed before completion");
    });
    return { versionId, suiteId: suite.suiteId, suiteDigest: suite.suiteDigest, state, cases, evidenceDigest };
  }

  async getEvaluation(versionId: string): Promise<EvaluationRecord | null> {
    if (!VERSION.test(versionId)) invalid("Invalid extension version ID");
    await this.ready();
    const row = (await this.options.adapter.query(
      `SELECT suite_id,suite_digest,state,cases_json,evidence_digest
       FROM _forge_fabric_extension_evaluations WHERE version_id=$1`, [versionId],
    )).rows[0];
    if (!row) return null;
    let cases: EvaluationCaseEvidence[];
    try { cases = JSON.parse(String(row.cases_json)) as EvaluationCaseEvidence[]; }
    catch { return invalid("Stored evaluation is not JSON"); }
    const state = row.state as EvaluationRecord["state"];
    const suite = this.suite;
    if (row.suite_id !== suite.suiteId || row.suite_digest !== suite.suiteDigest ||
        !["running", "passed", "failed", "inconclusive"].includes(state) ||
        !Array.isArray(cases) ||
        (state === "running" || state === "inconclusive" ? cases.length !== 0 || row.evidence_digest !== null :
          cases.length !== suite.caseIds.length || cases.some((item, index) =>
            item?.caseId !== suite.caseIds[index] || typeof item.passed !== "boolean" ||
            !validDigest(item.evidenceDigest)) ||
          (state === "passed") !== cases.every((item) => item.passed) ||
          row.evidence_digest !== digestCanonical(
            { versionId, suiteId: suite.suiteId, suiteDigest: suite.suiteDigest, cases }, sha256Digest,
          ))) invalid("Stored evaluation evidence is inconsistent");
    return { versionId, suiteId: suite.suiteId, suiteDigest: suite.suiteDigest, state,
      cases, evidenceDigest: row.evidence_digest as Digest | null };
  }

  async selected(extensionKey: string, channel: EvolutionChannel): Promise<string | null> {
    if (!KEY.test(extensionKey) || !["canary", "stable"].includes(channel)) invalid("Invalid selection query");
    await this.ready();
    const row = (await this.options.adapter.query(
      `SELECT version_id FROM _forge_fabric_extension_selections WHERE extension_key=$1 AND channel=$2`,
      [extensionKey, channel],
    )).rows[0];
    const versionId = row?.version_id as string | null ?? null;
    if (versionId && (await this.options.adapter.query(
      `SELECT version_id FROM _forge_fabric_extension_revocations WHERE version_id=$1`, [versionId],
    )).rows.length > 0) invalid("Selected extension is revoked");
    return versionId;
  }

  async decide(action: EvolutionDecisionAction, versionId: string, expectedSelection: string | null): Promise<void> {
    if (!["canary", "promote", "rollback", "revoke"].includes(action) || !VERSION.test(versionId) ||
        (expectedSelection !== null && !VERSION.test(expectedSelection))) invalid("Invalid evolution decision");
    const version = await this.getVersion(versionId);
    if (!version) throw new AgentFabricError("AF_NOT_FOUND", "Extension version not found");
    const channel: EvolutionChannel = action === "canary" ? "canary" : "stable";
    const evaluation = await this.getEvaluation(versionId);
    if (action !== "revoke" && evaluation?.state !== "passed") {
      conflict("Passing fixed-suite evaluation is required for selection");
    }
    const challenge: OwnerDecisionChallenge = {
      decisionNonce: randomUUID(),
      action, versionId, extensionKey: version.extensionKey, expectedSelection,
      evaluationDigest: evaluation?.evidenceDigest ?? null,
    };
    const proof = await this.options.ownerVerifier.verify(structuredClone(challenge));
    const challengeDigest = digestCanonical(challenge, sha256Digest);
    if (!proof || !KEY.test(proof.verifierId) || proof.challengeDigest !== challengeDigest ||
        !validDigest(proof.evidenceDigest)) invalid("Trusted owner verification did not bind this decision");
    const decidedAt = this.now();
    if (!validTime(decidedAt)) invalid("Invalid registry time");
    await this.serialized(async () => this.transaction(async (tx) => {
      const current = (await tx.query(
        `SELECT version_id FROM _forge_fabric_extension_selections WHERE extension_key=$1 AND channel=$2`,
        [version.extensionKey, channel],
      )).rows[0]?.version_id as string | null ?? null;
      if (current !== expectedSelection) conflict("Selection changed before owner decision");
      const revoked = (await tx.query(
        `SELECT version_id FROM _forge_fabric_extension_revocations WHERE version_id=$1`, [versionId],
      )).rows.length > 0;
      if (revoked) conflict("Revoked extension cannot be selected or decided again");
      if (action !== "revoke") {
        const storedEvaluation = (await tx.query(
          `SELECT state,evidence_digest FROM _forge_fabric_extension_evaluations WHERE version_id=$1`,
          [versionId],
        )).rows[0];
        if (storedEvaluation?.state !== "passed" ||
            storedEvaluation.evidence_digest !== challenge.evaluationDigest) {
          conflict("Passing fixed-suite evaluation is required for selection");
        }
        if (action === "rollback" && (await tx.query(
          `SELECT version_id FROM _forge_fabric_extension_decisions
           WHERE version_id=$1 AND action IN ('promote','rollback') LIMIT 1`, [versionId],
        )).rows.length === 0) conflict("Rollback target was never a stable version");
      }
      await tx.query(
        `INSERT INTO _forge_fabric_extension_decisions
         (version_id,extension_key,action,challenge_digest,owner_evidence_digest,verifier_id,decided_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [versionId, version.extensionKey, action, challengeDigest, proof.evidenceDigest, proof.verifierId, decidedAt],
      );
      if (action === "revoke") {
        await tx.query(`INSERT INTO _forge_fabric_extension_revocations (version_id,decided_at) VALUES ($1,$2)`,
          [versionId, decidedAt]);
        await tx.query(
          `UPDATE _forge_fabric_extension_selections SET version_id=NULL
           WHERE extension_key=$1 AND version_id=$2`, [version.extensionKey, versionId],
        );
      } else {
        await tx.query(
          `INSERT INTO _forge_fabric_extension_selections (extension_key,channel,version_id)
           VALUES ($1,$2,$3) ON CONFLICT (extension_key,channel)
           DO UPDATE SET version_id=EXCLUDED.version_id`,
          [version.extensionKey, channel, versionId],
        );
      }
    }));
  }

  async bindAttempt(attemptId: string, extensionKey: string, channel: EvolutionChannel): Promise<{
    attemptId: string; versionId: string; extensionKey: string; channel: EvolutionChannel;
  }> {
    if (!ATTEMPT.test(attemptId) || !KEY.test(extensionKey) || !["canary", "stable"].includes(channel)) {
      invalid("Invalid attempt binding");
    }
    const boundAt = this.now();
    if (!validTime(boundAt)) invalid("Invalid registry time");
    return this.serialized(async () => this.transaction(async (tx) => {
      const old = (await tx.query(
        `SELECT version_id,extension_key,channel FROM _forge_fabric_extension_attempts WHERE attempt_id=$1`, [attemptId],
      )).rows[0];
      if (old) {
        conflict("Attempt is already bound; read its existing version instead of dispatching again");
      }
      const versionId = (await tx.query(
        `SELECT version_id FROM _forge_fabric_extension_selections WHERE extension_key=$1 AND channel=$2`,
        [extensionKey, channel],
      )).rows[0]?.version_id as string | null;
      if (!versionId) conflict("No extension selected on this channel");
      if ((await tx.query(
        `SELECT version_id FROM _forge_fabric_extension_revocations WHERE version_id=$1`, [versionId],
      )).rows.length > 0) conflict("Revoked extension cannot be selected");
      await tx.query(
        `INSERT INTO _forge_fabric_extension_attempts
         (attempt_id,version_id,extension_key,channel,bound_at) VALUES ($1,$2,$3,$4,$5)`,
        [attemptId, versionId, extensionKey, channel, boundAt],
      );
      return { attemptId, versionId, extensionKey, channel };
    }));
  }

  async getAttempt(attemptId: string): Promise<{ attemptId: string; versionId: string;
    extensionKey: string; channel: EvolutionChannel } | null> {
    if (!ATTEMPT.test(attemptId)) invalid("Invalid attempt identity");
    await this.ready();
    const row = (await this.options.adapter.query(
      `SELECT version_id,extension_key,channel FROM _forge_fabric_extension_attempts WHERE attempt_id=$1`,
      [attemptId],
    )).rows[0];
    if (!row) return null;
    return { attemptId, versionId: row.version_id as string,
      extensionKey: row.extension_key as string, channel: row.channel as EvolutionChannel };
  }
}
