import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { DbAdapter } from "../runtime/db/adapter.ts";
import { sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { localFabricPath } from "./local-paths.ts";
import type { Digest } from "./types.ts";

const CREATE_EFFECTS_TABLE = `
  CREATE TABLE IF NOT EXISTS _forge_agent_fabric_local_effects (
    request_digest TEXT PRIMARY KEY,
    challenge_digest TEXT NOT NULL,
    task_id TEXT NOT NULL,
    subject_digest TEXT NOT NULL,
    artifact_digest TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    authorization_digest TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('intent', 'receipted')),
    intent_at BIGINT NOT NULL,
    receipt_digest TEXT,
    receipt_at BIGINT
  )`;

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const TASK_ID = /^task:[0-9a-f]{64}$/u;

/** The only effect admitted by this local broker. The destination is never client supplied. */
export interface LocalArtifactEffectRequest {
  kind: "immutable_local_artifact_v1";
  taskId: string;
  subjectDigest: Digest;
  content: string;
}

export interface LocalEffectAuthorization {
  ownerId: string;
  challengeDigest: Digest;
  expiresAt: number;
  proof: string;
}

export interface LocalEffectChallenge {
  repositoryRoot: string;
  targetPath: string;
  request: LocalArtifactEffectRequest;
  requestDigest: Digest;
  challengeDigest: Digest;
  artifactDigest: Digest;
  expiresAt: number;
}

export interface LocalEffectReceipt {
  requestDigest: Digest;
  artifactDigest: Digest;
  readbackDigest: Digest;
  receiptDigest: Digest;
  receivedAt: number;
}

export type LocalEffectObservation =
  | { state: "not_dispatched"; requestDigest: Digest }
  | { state: "receipt_unknown" | "incomplete_materialization" | "materialized_without_receipt" | "receipt_mismatch";
      requestDigest: Digest; expectedArtifactDigest: Digest; observedArtifactDigest?: Digest }
  | { state: "receipted"; requestDigest: Digest; receipt: LocalEffectReceipt };

export interface LocalEffectOwnerVerifier {
  (challenge: LocalEffectChallenge, authorization: LocalEffectAuthorization): Promise<boolean> | boolean;
}

export type LocalEffectBoundary = "after_intent" | "after_open" | "after_write" | "after_readback" | "after_receipt";

export interface LocalEffectBrokerOptions {
  adapter: DbAdapter;
  repositoryRoot: string;
  ownerId: string;
  verifyOwner: LocalEffectOwnerVerifier;
  /** Trusted clock; injectable only by the owner service for deterministic tests. */
  now?: () => number;
  /** Fault injection is for deterministic crash-boundary tests. Never exposes a client route. */
  onBoundary?: (boundary: LocalEffectBoundary) => Promise<void> | void;
}

interface StoredEffect {
  requestDigest: Digest;
  challengeDigest: Digest;
  taskId: string;
  subjectDigest: Digest;
  artifactDigest: Digest;
  ownerId: string;
  authorizationDigest: Digest;
  state: "intent" | "receipted";
  intentAt: number;
  receiptDigest: Digest | null;
  receiptAt: number | null;
}

function reject(message: string): never {
  throw new AgentFabricError("AF_PERMIT_REJECTED", message);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join("\0") === [...expected].sort().join("\0");
}

function validateRequest(input: unknown): LocalArtifactEffectRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) reject("Effect request must be an object");
  const value = input as Record<string, unknown>;
  if (!exactKeys(value, ["kind", "taskId", "subjectDigest", "content"]) ||
      value.kind !== "immutable_local_artifact_v1" ||
      typeof value.taskId !== "string" || !TASK_ID.test(value.taskId) ||
      typeof value.subjectDigest !== "string" || !DIGEST.test(value.subjectDigest) ||
      typeof value.content !== "string" ||
      Buffer.byteLength(value.content, "utf8") > 4096) {
    reject("Effect is outside the bounded immutable artifact contract");
  }
  return value as unknown as LocalArtifactEffectRequest;
}

function artifactBytes(request: LocalArtifactEffectRequest): string {
  return stableStringify({
    version: 1, taskId: request.taskId, subjectDigest: request.subjectDigest,
    content: request.content,
  });
}

function digestBytes(bytes: string | Buffer): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * One PGlite owner, one effect kind. Authorization is supplied by trusted owner ingress,
 * and the immutable target is derived only from the request digest. An intent is committed
 * before materialization; replay of an uncertain intent never dispatches it again.
 */
export class LocalEffectBroker {
  private schemaReady?: Promise<unknown>;
  private tail: Promise<void> = Promise.resolve();
  private readonly repositoryRoot: string;

  constructor(private readonly options: LocalEffectBrokerOptions) {
    if (options.adapter.kind !== "pglite" || !options.ownerId ||
        typeof options.verifyOwner !== "function" ||
        !isAbsolute(options.repositoryRoot)) {
      throw new AgentFabricError("AF_INVALID_STATE", "Local effect broker requires a PGlite owner and absolute repository root");
    }
    this.repositoryRoot = resolve(options.repositoryRoot);
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((done) => { release = done; });
    await previous;
    try {
      this.schemaReady ??= this.options.adapter.query(CREATE_EFFECTS_TABLE);
      await this.schemaReady;
      return await operation();
    } finally {
      release();
    }
  }

  private artifactPath(requestDigest: Digest): string {
    if (!DIGEST.test(requestDigest)) reject("Invalid request digest");
    return localFabricPath(this.repositoryRoot, "effects", `${requestDigest.slice(7)}.json`);
  }

  private resolve(input: unknown, expiresAt: number): {
    request: LocalArtifactEffectRequest; challenge: LocalEffectChallenge; bytes: string;
  } {
    const request = validateRequest(input);
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0) reject("Invalid owner approval expiry");
    const bytes = artifactBytes(request);
    const requestDigest = sha256Digest(stableStringify({
      version: 1, repositoryRoot: this.repositoryRoot, request,
    }));
    const artifactDigest = digestBytes(bytes);
    const challengeDigest = sha256Digest(stableStringify({
      version: 1, requestDigest, artifactDigest, ownerId: this.options.ownerId, expiresAt,
    }));
    return { request, bytes, challenge: {
      repositoryRoot: this.repositoryRoot,
      targetPath: this.artifactPath(requestDigest),
      request, requestDigest, challengeDigest, artifactDigest, expiresAt,
    } };
  }

  /** Resolve a proposal for display by trusted owner UI before seeking approval. */
  prepare(input: unknown, expiresAt: number): LocalEffectChallenge {
    return this.resolve(input, expiresAt).challenge;
  }

  private async load(requestDigest: Digest): Promise<StoredEffect | null> {
    const result = await this.options.adapter.query(
      `SELECT * FROM _forge_agent_fabric_local_effects WHERE request_digest = $1`, [requestDigest],
    );
    const row = result.rows[0];
    if (!row) return null;
    if (row.request_digest !== requestDigest || !DIGEST.test(String(row.challenge_digest)) ||
        !TASK_ID.test(String(row.task_id)) || !DIGEST.test(String(row.subject_digest)) ||
        !DIGEST.test(String(row.artifact_digest)) || !DIGEST.test(String(row.authorization_digest)) ||
        (row.state !== "intent" && row.state !== "receipted") ||
        (row.state === "receipted" && (!DIGEST.test(String(row.receipt_digest)) || row.receipt_at === null))) {
      throw new AgentFabricError("AF_INVALID_STATE", "Stored effect row is inconsistent");
    }
    return {
      requestDigest, challengeDigest: row.challenge_digest as Digest,
      taskId: String(row.task_id), subjectDigest: row.subject_digest as Digest,
      artifactDigest: row.artifact_digest as Digest, ownerId: String(row.owner_id),
      authorizationDigest: row.authorization_digest as Digest,
      state: row.state, intentAt: Number(row.intent_at),
      receiptDigest: row.receipt_digest === null ? null : row.receipt_digest as Digest,
      receiptAt: row.receipt_at === null ? null : Number(row.receipt_at),
    };
  }

  private async readback(requestDigest: Digest): Promise<Digest | null> {
    try {
      return digestBytes(await readFile(this.artifactPath(requestDigest)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async observe(stored: StoredEffect | null, requestDigest: Digest): Promise<LocalEffectObservation> {
    if (!stored) return { state: "not_dispatched", requestDigest };
    const observed = await this.readback(requestDigest);
    if (stored.state === "intent") {
      if (observed !== null && observed !== stored.artifactDigest) {
        return { state: "incomplete_materialization", requestDigest,
          expectedArtifactDigest: stored.artifactDigest, observedArtifactDigest: observed };
      }
      return observed === null
        ? { state: "receipt_unknown", requestDigest, expectedArtifactDigest: stored.artifactDigest }
        : { state: "materialized_without_receipt", requestDigest,
          expectedArtifactDigest: stored.artifactDigest, observedArtifactDigest: observed };
    }
    if (observed !== null && observed !== stored.artifactDigest) {
      return { state: "receipt_mismatch", requestDigest,
        expectedArtifactDigest: stored.artifactDigest, observedArtifactDigest: observed };
    }
    if (observed === null || stored.receiptDigest === null || stored.receiptAt === null) {
      return { state: "receipt_mismatch", requestDigest, expectedArtifactDigest: stored.artifactDigest };
    }
    const receipt: LocalEffectReceipt = {
      requestDigest, artifactDigest: stored.artifactDigest, readbackDigest: observed,
      receiptDigest: stored.receiptDigest, receivedAt: stored.receiptAt,
    };
    const expected = sha256Digest(stableStringify({
      version: 1, requestDigest, artifactDigest: stored.artifactDigest,
      readbackDigest: observed, receivedAt: stored.receiptAt,
    }));
    if (expected !== stored.receiptDigest) {
      return { state: "receipt_mismatch", requestDigest, expectedArtifactDigest: stored.artifactDigest,
        observedArtifactDigest: observed };
    }
    return { state: "receipted", requestDigest, receipt };
  }

  /** Independent disk readback. This never mutates or retries an effect. */
  async inspect(requestDigest: Digest): Promise<LocalEffectObservation> {
    if (!DIGEST.test(requestDigest)) reject("Invalid request digest");
    return this.serialized(async () => this.observe(await this.load(requestDigest), requestDigest));
  }

  /** Reconciliation is read-only; an ambiguous receipt remains ambiguous. */
  async reconcile(requestDigest: Digest): Promise<LocalEffectObservation> {
    return this.inspect(requestDigest);
  }

  async dispatch(input: unknown, authorization: LocalEffectAuthorization): Promise<LocalEffectObservation> {
    if (!authorization || typeof authorization !== "object" ||
        !exactKeys(authorization as unknown as Record<string, unknown>,
          ["ownerId", "challengeDigest", "expiresAt", "proof"]) ||
        typeof authorization.proof !== "string" || !authorization.proof ||
        authorization.proof.length > 4096) reject("Invalid owner authorization");
    const { request, challenge, bytes } = this.resolve(input, authorization.expiresAt);
    if (authorization.ownerId !== this.options.ownerId ||
        authorization.challengeDigest !== challenge.challengeDigest) {
      reject("Owner authorization does not bind this effect");
    }
    return this.serialized(async () => {
      const existing = await this.load(challenge.requestDigest);
      if (existing) return this.observe(existing, challenge.requestDigest);
      const readClock = () => this.options.now?.() ?? Date.now();
      const isCurrent = () => {
        const current = readClock();
        return Number.isSafeInteger(current) && current >= 0 && current < authorization.expiresAt;
      };
      if (!isCurrent()) reject("Owner authorization expired before effect dispatch");
      if (!(await this.options.verifyOwner(challenge, authorization))) reject("Owner authorization was not verified");
      if (!isCurrent()) reject("Owner authorization expired during effect verification");
      const authorizationDigest = sha256Digest(stableStringify({
        version: 1, ownerId: authorization.ownerId, challengeDigest: challenge.challengeDigest,
        proofDigest: digestBytes(authorization.proof),
      }));
      const dir = localFabricPath(this.repositoryRoot, "effects");
      await mkdir(dir, { recursive: true });
      this.artifactPath(challenge.requestDigest); // reject symbolic-link substitution before intent
      const now = readClock();
      if (!Number.isSafeInteger(now) || now < 0 || now >= authorization.expiresAt) {
        reject("Owner authorization expired before effect intent");
      }
      const inserted = await this.options.adapter.query(
        `INSERT INTO _forge_agent_fabric_local_effects
         (request_digest, challenge_digest, task_id, subject_digest, artifact_digest,
          owner_id, authorization_digest, state, intent_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'intent',$8) ON CONFLICT (request_digest) DO NOTHING`,
        [challenge.requestDigest, challenge.challengeDigest, request.taskId, request.subjectDigest,
          challenge.artifactDigest, authorization.ownerId, authorizationDigest, now],
      );
      if (inserted.rowCount !== 1) {
        return this.observe(await this.load(challenge.requestDigest), challenge.requestDigest);
      }
      // From here on, any failure is uncertain. A second dispatch only observes.
      await this.options.onBoundary?.("after_intent");
      const handle = await open(this.artifactPath(challenge.requestDigest), "wx", 0o600);
      try {
        await this.options.onBoundary?.("after_open");
        await handle.writeFile(bytes, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.options.onBoundary?.("after_write");
      const observed = await this.readback(challenge.requestDigest);
      await this.options.onBoundary?.("after_readback");
      if (observed !== challenge.artifactDigest) {
        return this.observe(await this.load(challenge.requestDigest), challenge.requestDigest);
      }
      const receivedAt = Date.now();
      const receiptDigest = sha256Digest(stableStringify({
        version: 1, requestDigest: challenge.requestDigest, artifactDigest: challenge.artifactDigest,
        readbackDigest: observed, receivedAt,
      }));
      await this.options.adapter.query(
        `UPDATE _forge_agent_fabric_local_effects
         SET state = 'receipted', receipt_digest = $2, receipt_at = $3
         WHERE request_digest = $1 AND state = 'intent'`,
        [challenge.requestDigest, receiptDigest, receivedAt],
      );
      await this.options.onBoundary?.("after_receipt");
      return this.observe(await this.load(challenge.requestDigest), challenge.requestDigest);
    });
  }
}
