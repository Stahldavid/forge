import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Digest, stableStringify } from "./canonical.ts";
import { runCodexAdversarialReview } from "./codex-adversarial-review.ts";
import { AgentFabricError } from "./errors.ts";
import { localFabricPath } from "./local-paths.ts";

const MAX_DIFF_BYTES = 1024 * 1024;
const MAX_PATHS = 100;
const MAX_ROUNDS = 8;

export interface LocalChangeProposal {
  objective: string;
  acceptanceCriteria: string[];
  implementer: string;
}

interface Contract extends LocalChangeProposal {
  schemaVersion: 1;
  changeId: string;
  repositoryRoot: string;
  baseCommit: string;
  createdAt: string;
  digest: string;
}

interface RoundIntent {
  schemaVersion: 1;
  round: number;
  baseCommit: string;
  contractDigest: string;
  diffDigest: string;
  diffBytes: number;
  changedPaths: string[];
  requestDigest: string;
  reviewer: "codex-cli";
  startedAt: string;
  digest: string;
}

interface RoundResult {
  schemaVersion: 1;
  intentDigest: string;
  finishedAt: string;
  state: "reported" | "inconclusive";
  report?: unknown;
  outputDigest?: string;
  usage?: unknown;
  error?: string;
  digest: string;
}

export interface LocalChangeStatus {
  changeId: string;
  state: "proposed" | "needs_review" | "review_uncertain" | "changes_requested" | "inconclusive" | "ready";
  contractDigest: string;
  baseCommit: string;
  currentDiffDigest: string | null;
  latestRound: number;
  reviewedDiffDigest: string | null;
  reviewerVerdict: string | null;
  canAccept: boolean;
}

function git(root: string, args: string[], options: { index?: string; input?: Buffer; maxBuffer?: number } = {}): Buffer {
  try {
    return execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=NUL", ...args], {
      cwd: root, env: options.index ? { ...process.env, GIT_INDEX_FILE: options.index } : process.env,
      input: options.input, encoding: "buffer", windowsHide: true, timeout: 30_000,
      maxBuffer: options.maxBuffer ?? MAX_DIFF_BYTES + 4096, stdio: ["pipe", "pipe", "ignore"],
    });
  } catch {
    throw new AgentFabricError("AF_INVALID_STATE", `Git operation failed: ${args[0] ?? "unknown"}`);
  }
}

function gitText(root: string, args: string[], options?: { index?: string; maxBuffer?: number }): string {
  return git(root, args, options).toString("utf8").trim();
}

function inertFilterOptions(root: string): string[] {
  let names = "";
  try {
    names = execFileSync("git", ["config", "--name-only", "--get-regexp",
      "^filter\\..*\\.(process|smudge|clean)$"], {
      cwd: root, encoding: "utf8", windowsHide: true, timeout: 10_000,
      maxBuffer: 64 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    if ((error as { status?: number }).status !== 1) {
      throw new AgentFabricError("AF_INVALID_STATE", "Cannot inspect Git filters");
    }
  }
  const options: string[] = [];
  for (const name of new Set(names.split(/\r?\n/u).filter(Boolean))) {
    if (!/^filter\.[a-z0-9_.-]+\.(?:process|smudge|clean)$/iu.test(name)) {
      throw new AgentFabricError("AF_INVALID_STATE", "Unsupported Git filter configuration");
    }
    options.push("-c", `${name}=`);
  }
  return options;
}

function digestBytes(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function checkedObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AgentFabricError("AF_INVALID_STATE", "Invalid change proposal");
  return value as Record<string, unknown>;
}

function validateProposal(value: unknown): LocalChangeProposal {
  const object = checkedObject(value);
  if (Object.keys(object).sort().join(",") !== "acceptanceCriteria,implementer,objective" ||
      typeof object.objective !== "string" || !object.objective.trim() || object.objective.length > 4000 ||
      !Array.isArray(object.acceptanceCriteria) || object.acceptanceCriteria.length < 1 || object.acceptanceCriteria.length > 20 ||
      !object.acceptanceCriteria.every((item) => typeof item === "string" && item.trim() && item.length <= 1000) ||
      typeof object.implementer !== "string" || !/^[a-z][a-z0-9-]{1,63}$/u.test(object.implementer)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Change proposal requires bounded objective, acceptanceCriteria, and implementer");
  }
  return object as unknown as LocalChangeProposal;
}

function sealed<T extends object>(value: T): T & { digest: string } {
  return { ...value, digest: sha256Digest(stableStringify(value)) };
}

function readSealed<T extends { digest: string }>(path: string): T {
  const bytes = readFileSync(path);
  if (bytes.length > MAX_DIFF_BYTES) throw new AgentFabricError("AF_CONFLICT", "Change record exceeds limit");
  let value: T;
  try { value = JSON.parse(bytes.toString("utf8")) as T; }
  catch { throw new AgentFabricError("AF_CONFLICT", "Change record is invalid JSON"); }
  if (!value || typeof value !== "object" || typeof value.digest !== "string") {
    throw new AgentFabricError("AF_CONFLICT", "Change record is invalid");
  }
  const { digest, ...unsigned } = value;
  if (sha256Digest(stableStringify(unsigned)) !== digest) throw new AgentFabricError("AF_CONFLICT", "Change record digest mismatch");
  return value;
}

function writeNew(path: string, value: unknown): void {
  writeFileSync(path, Buffer.isBuffer(value) ? value : JSON.stringify(value), { flag: "wx", mode: 0o600 });
}

function recordPath(root: string, id: string, filename: string): string {
  if (!/^change:[0-9a-f-]{36}$/u.test(id)) throw new AgentFabricError("AF_INVALID_STATE", "Invalid change ID");
  return localFabricPath(root, "change-reviews", id.slice(7), filename);
}

function roundName(round: number, suffix: string): string { return `round-${String(round).padStart(3, "0")}.${suffix}`; }

function reviewPrompt(contract: Contract, diffDigest: string, paths: string[]): string {
  return `Adversarially review this exact change against its acceptance criteria. Report only concrete findings. Do not edit files.\nObjective: ${contract.objective}\nAcceptance criteria: ${JSON.stringify(contract.acceptanceCriteria)}\nBase commit: ${contract.baseCommit}\nDiff digest: ${diffDigest}\nChanged paths: ${JSON.stringify(paths)}`;
}

interface CapturedDiff { bytes: Buffer; digest: string; paths: string[] }

function capture(root: string, baseCommit: string): CapturedDiff {
  if (gitText(root, ["rev-parse", "HEAD"]) !== baseCommit) {
    throw new AgentFabricError("AF_CONFLICT", "Change checkout moved from its pinned base commit");
  }
  // A separate index captures staged, unstaged, and non-ignored new files without changing the user's index.
  const tempParent = localFabricPath(root, "change-reviews", "tmp");
  mkdirSync(tempParent, { recursive: true, mode: 0o700 });
  const temp = mkdtempSync(join(tempParent, "index-"));
  try {
    const index = join(temp, "index");
    git(root, ["read-tree", baseCommit], { index });
    git(root, [...inertFilterOptions(root), "add", "-A", "--", ".", ":(exclude).forge/local/**", ":(exclude).forge/delta/**"], { index });
    const paths = git(root, ["diff", "--cached", "--name-only", "-z", baseCommit], { index }).toString("utf8").split("\0").filter(Boolean);
    if (paths.length > MAX_PATHS || paths.some((path) => path.startsWith(".forge/local/") || path.startsWith(".forge/delta/") || path.includes("\0"))) {
      throw new AgentFabricError("AF_INVALID_STATE", "Change contains too many paths or local state");
    }
    for (const path of paths) {
      const mode = gitText(root, ["ls-files", "-s", "--", path], { index }).split(" ")[0];
      if (mode && mode !== "100644" && mode !== "100755") {
        throw new AgentFabricError("AF_INVALID_STATE", "Change contains a symlink or submodule");
      }
    }
    git(root, ["diff", "--cached", "--check", baseCommit], { index });
    const bytes = git(root, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", baseCommit], { index });
    if (bytes.length > MAX_DIFF_BYTES || bytes.includes(Buffer.from("GIT binary patch"))) {
      throw new AgentFabricError("AF_INVALID_STATE", "Change diff exceeds limit or contains binary data");
    }
    return { bytes, digest: digestBytes(bytes), paths };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function materialize(root: string, id: string, round: number, base: string, diff: CapturedDiff): string {
  const checkout = localFabricPath(root, "change-reviews", id.slice(7), `checkout-${round}`);
  const hooks = localFabricPath(root, "change-reviews", "empty-hooks");
  mkdirSync(hooks, { recursive: true });
  git(root, ["-c", `core.hooksPath=${hooks}`, "worktree", "add", "--detach", "--no-checkout", "--", checkout, base]);
  git(checkout, ["-c", `core.hooksPath=${hooks}`, ...inertFilterOptions(checkout), "reset", "--hard", base]);
  git(checkout, [...inertFilterOptions(checkout), "apply", "--index", "--binary", "-"], { input: diff.bytes });
  const staged = git(checkout, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", base]);
  if (digestBytes(staged) !== diff.digest) throw new AgentFabricError("AF_CONFLICT", "Review snapshot differs from captured change");
  return checkout;
}

function verifySnapshot(checkout: string, base: string, expected: string): void {
  if (gitText(checkout, ["rev-parse", "HEAD"]) !== base ||
      git(checkout, ["diff", "--no-ext-diff", "--binary"]).length ||
      git(checkout, ["ls-files", "--others", "--exclude-standard"]).length ||
      digestBytes(git(checkout, ["diff", "--cached", "--no-ext-diff", "--no-textconv", "--binary", "--full-index", base])) !== expected) {
    throw new AgentFabricError("AF_CONFLICT", "Reviewer snapshot was modified");
  }
}

export class LocalChangeReviewService {
  private constructor(readonly repositoryRoot: string,
    private readonly reviewRunner: typeof runCodexAdversarialReview) {}

  static async open(repositoryRoot: string, options: { reviewRunner?: typeof runCodexAdversarialReview } = {}): Promise<LocalChangeReviewService> {
    const root = realpathSync(repositoryRoot);
    if (realpathSync(gitText(root, ["rev-parse", "--show-toplevel"])) !== root) {
      throw new AgentFabricError("AF_INVALID_STATE", "Change review requires a repository root");
    }
    return new LocalChangeReviewService(root, options.reviewRunner ?? runCodexAdversarialReview);
  }

  async close(): Promise<void> { /* filesystem records do not retain handles */ }

  private contract(id: string): Contract {
    const contract = readSealed<Contract>(recordPath(this.repositoryRoot, id, "contract.json"));
    if (contract.changeId !== id || contract.repositoryRoot !== this.repositoryRoot || contract.schemaVersion !== 1) {
      throw new AgentFabricError("AF_CONFLICT", "Change contract identity mismatch");
    }
    return contract;
  }

  private withLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const path = recordPath(this.repositoryRoot, id, "operation.lock");
    let fd: number;
    try { fd = openSync(path, "wx", 0o600); }
    catch { throw new AgentFabricError("AF_CONFLICT", "Change operation already active or interrupted; inspect evidence before recovery"); }
    return fn().finally(() => { closeSync(fd); unlinkSync(path); });
  }

  async propose(value: unknown): Promise<LocalChangeStatus> {
    const request = validateProposal(value);
    const changeId = `change:${randomUUID()}`;
    const directory = localFabricPath(this.repositoryRoot, "change-reviews", changeId.slice(7));
    mkdirSync(localFabricPath(this.repositoryRoot, "change-reviews"), { recursive: true, mode: 0o700 });
    mkdirSync(directory, { recursive: false, mode: 0o700 });
    const contract = sealed({ schemaVersion: 1 as const, ...request, changeId,
      repositoryRoot: this.repositoryRoot, baseCommit: gitText(this.repositoryRoot, ["rev-parse", "HEAD"]),
      createdAt: new Date().toISOString() });
    writeNew(join(directory, "contract.json"), contract);
    return this.status(changeId);
  }

  async status(id: string): Promise<LocalChangeStatus> {
    const contract = this.contract(id);
    const directory = localFabricPath(this.repositoryRoot, "change-reviews", id.slice(7));
    const names = readdirSync(directory).filter((name) => /^round-\d{3}\.intent\.json$/u.test(name)).sort();
    if (names.length > MAX_ROUNDS) throw new AgentFabricError("AF_CONFLICT", "Change has too many review rounds");
    let last: RoundIntent | undefined;
    let result: RoundResult | undefined;
    for (let index = 0; index < names.length; index += 1) {
      const intent = readSealed<RoundIntent>(join(directory, names[index]!));
      if (intent.round !== index + 1 || intent.baseCommit !== contract.baseCommit ||
          intent.contractDigest !== contract.digest || intent.schemaVersion !== 1) {
        throw new AgentFabricError("AF_CONFLICT", "Review round chain is inconsistent");
      }
      const prompt = reviewPrompt(contract, intent.diffDigest, intent.changedPaths);
      if (intent.requestDigest !== sha256Digest(stableStringify({ contractDigest: contract.digest,
        diffDigest: intent.diffDigest, round: intent.round, prompt }))) {
        throw new AgentFabricError("AF_CONFLICT", "Review request digest mismatch");
      }
      const diff = readFileSync(join(directory, roundName(intent.round, "patch")));
      if (diff.length !== intent.diffBytes || digestBytes(diff) !== intent.diffDigest) {
        throw new AgentFabricError("AF_CONFLICT", "Recorded review diff was modified");
      }
      last = intent;
      const resultPath = join(directory, roundName(intent.round, "result.json"));
      result = existsSync(resultPath) ? readSealed<RoundResult>(resultPath) : undefined;
      if (result && result.intentDigest !== intent.digest) throw new AgentFabricError("AF_CONFLICT", "Review result is detached from its intent");
      if (result?.state === "reported") {
        const report = result.report as { requestDigest?: string; verdict?: string; findings?: unknown[] } | undefined;
        if (!report || report.requestDigest !== intent.requestDigest ||
            !["pass", "changes_requested"].includes(report.verdict ?? "") ||
            !Array.isArray(report.findings) ||
            (report.verdict === "pass" ? report.findings.length !== 0 : report.findings.length === 0) ||
            !/^sha256:[0-9a-f]{64}$/u.test(result.outputDigest ?? "")) {
          throw new AgentFabricError("AF_CONFLICT", "Stored reviewer report is invalid");
        }
      } else if (result && result.state !== "inconclusive") {
        throw new AgentFabricError("AF_CONFLICT", "Stored reviewer state is invalid");
      }
      if (!result && index < names.length - 1) throw new AgentFabricError("AF_CONFLICT", "New round follows unfinished review");
    }
    const current = capture(this.repositoryRoot, contract.baseCommit);
    const same = !!last && current.digest === last.diffDigest;
    const verdict = result?.state === "reported" && result.report && typeof result.report === "object"
      ? (result.report as { verdict?: string }).verdict ?? null : null;
    const state: LocalChangeStatus["state"] = !last ? "proposed" : !same ? "needs_review" : !result ? "review_uncertain"
      : result.state === "inconclusive" ? "inconclusive" : verdict === "pass" ? "ready" : "changes_requested";
    return { changeId: id, state, contractDigest: contract.digest, baseCommit: contract.baseCommit,
      currentDiffDigest: current.bytes.length ? current.digest : null, latestRound: last?.round ?? 0,
      reviewedDiffDigest: last?.diffDigest ?? null, reviewerVerdict: verdict, canAccept: state === "ready" };
  }

  async evidence(id: string): Promise<{ status: LocalChangeStatus; rounds: unknown[] }> {
    const status = await this.status(id);
    const directory = localFabricPath(this.repositoryRoot, "change-reviews", id.slice(7));
    const rounds: unknown[] = [];
    for (let round = 1; round <= status.latestRound; round += 1) {
      const intent = readSealed<RoundIntent>(join(directory, roundName(round, "intent.json")));
      const resultPath = join(directory, roundName(round, "result.json"));
      const result = existsSync(resultPath) ? readSealed<RoundResult>(resultPath) : undefined;
      rounds.push({ round, diffDigest: intent.diffDigest, changedPaths: intent.changedPaths,
        requestDigest: intent.requestDigest, reviewer: intent.reviewer, startedAt: intent.startedAt,
        state: result?.state ?? "uncertain", report: result?.report ?? null, error: result?.error ?? null,
        outputDigest: result?.outputDigest ?? null, usage: result?.usage ?? null });
    }
    return { status, rounds };
  }

  async review(id: string): Promise<LocalChangeStatus> {
    const contract = this.contract(id);
    if (contract.implementer === "codex-cli") throw new AgentFabricError("AF_CONFLICT", "Implementer cannot review its own change");
    return this.withLock(id, async () => {
      const previous = await this.status(id);
      if (previous.state === "review_uncertain") throw new AgentFabricError("AF_CONFLICT", "Interrupted review requires owner inspection");
      if (previous.latestRound >= MAX_ROUNDS) throw new AgentFabricError("AF_RESOURCE_EXHAUSTED", "Review round limit reached");
      const diff = capture(this.repositoryRoot, contract.baseCommit);
      if (!diff.bytes.length) throw new AgentFabricError("AF_INVALID_STATE", "No change diff to review");
      if (previous.reviewedDiffDigest === diff.digest && previous.state !== "inconclusive") {
        throw new AgentFabricError("AF_CONFLICT", "This exact diff was already reviewed");
      }
      const round = previous.latestRound + 1;
      const directory = localFabricPath(this.repositoryRoot, "change-reviews", id.slice(7));
      const prompt = reviewPrompt(contract, diff.digest, diff.paths);
      const requestDigest = sha256Digest(stableStringify({ contractDigest: contract.digest, diffDigest: diff.digest, round, prompt }));
      const intent = sealed({ schemaVersion: 1 as const, round, baseCommit: contract.baseCommit,
        contractDigest: contract.digest, diffDigest: diff.digest, diffBytes: diff.bytes.length,
        changedPaths: diff.paths, requestDigest, reviewer: "codex-cli" as const,
        startedAt: new Date().toISOString() });
      const patchPath = join(directory, roundName(round, "patch"));
      if (existsSync(patchPath)) {
        // An orphan patch means a prior process stopped before recording its intent,
        // which is before model dispatch. The operation lock prevents a live peer.
        if (!lstatSync(patchPath).isFile() || existsSync(join(directory, roundName(round, "intent.json")))) {
          throw new AgentFabricError("AF_CONFLICT", "Review patch already has an intent or unsafe file type");
        }
        if (!readFileSync(patchPath).equals(diff.bytes)) unlinkSync(patchPath);
      }
      if (!existsSync(patchPath)) writeNew(patchPath, diff.bytes);
      writeNew(join(directory, roundName(round, "intent.json")), intent);
      // From this point a crash leaves an uncertain durable intent. Never auto-dispatch a duplicate paid turn.
      let outcome: Awaited<ReturnType<typeof runCodexAdversarialReview>>;
      try {
        const checkout = materialize(this.repositoryRoot, id, round, contract.baseCommit, diff);
        outcome = await this.reviewRunner({ workspaceRoot: checkout, prompt, requestDigest,
          timeoutMs: 120_000, maxOutputBytes: 256 * 1024 });
        verifySnapshot(checkout, contract.baseCommit, diff.digest);
      } catch (error) {
        outcome = { state: "inconclusive", error: error instanceof Error ? error.message : "Review failed" };
      }
      const result = sealed({ schemaVersion: 1 as const, intentDigest: intent.digest,
        finishedAt: new Date().toISOString(), state: outcome.state,
        ...(outcome.outputDigest ? { outputDigest: outcome.outputDigest } : {}),
        ...(outcome.usage ? { usage: outcome.usage } : {}),
        ...(outcome.state === "reported" ? { report: outcome.report } : { error: outcome.error ?? "Review inconclusive" }) });
      writeNew(join(directory, roundName(round, "result.json")), result);
      return this.status(id);
    });
  }
}
