import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { sha256Digest } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { LocalCodingTaskProposal } from "./local-task-contract.ts";
import type { Digest } from "./types.ts";
import { localFabricPath } from "./local-paths.ts";

function git(root: string, args: readonly string[], maxBuffer = 128 * 1024): string {
  try {
    return execFileSync("git", [...args], {
      cwd: root, encoding: "utf8", windowsHide: true,
      timeout: 10_000, maxBuffer, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new AgentFabricError("AF_INVALID_STATE", `Git operation failed: ${args[0] ?? "unknown"}`);
  }
}

export function buildLocalCodingContext(repositoryRoot: string, task: Readonly<LocalCodingTaskProposal>): string {
  const sources = task.sourcePaths.map((path) => ({
    path,
    content: git(repositoryRoot, ["show", `${task.baseCommit}:${path}`], task.limits.maximumContextBytes + 1),
  }));
  const content = JSON.stringify({ baseCommit: task.baseCommit, sources });
  if (Buffer.byteLength(content, "utf8") > task.limits.maximumContextBytes) {
    throw new AgentFabricError("AF_INVALID_STATE", "Pinned source context exceeds the approved byte limit");
  }
  return content;
}

function validateModelFiles(text: string, task: Readonly<LocalCodingTaskProposal>): readonly { path: string; content: string }[] {
  if (Buffer.byteLength(text, "utf8") > task.limits.maximumPatchBytes) {
    throw new AgentFabricError("AF_INVALID_STATE", "Model output exceeds the approved patch byte limit");
  }
  let parsed: unknown;
  const fenced = /^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/u.exec(text.trim());
  try { parsed = JSON.parse(fenced ? fenced[1]! : text); } catch {
    throw new AgentFabricError("AF_INVALID_STATE", "Model output is not strict JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AgentFabricError("AF_INVALID_STATE", "Model output is not a file proposal");
  }
  // Small local models sometimes emit the files array directly. Both forms
  // undergo the same strict path, content, count, and size checks below.
  const root = parsed as Record<string, unknown>;
  const rootKeys = Object.keys(root).sort().join(",");
  const fileMap = !Array.isArray(parsed) && rootKeys !== "files" &&
    rootKeys !== "files,schemaVersion" && Object.keys(root).every((path) =>
      task.writablePaths.includes(path) && typeof root[path] === "string");
  const proposedFiles = Array.isArray(parsed) ? parsed : fileMap
    ? Object.entries(root).map(([path, content]) => ({ path, content })) : root.files;
  if ((!Array.isArray(parsed) && !fileMap &&
      (rootKeys !== "files" &&
       (rootKeys !== "files,schemaVersion" ||
        (root.schemaVersion !== 1 && root.schemaVersion !== "1")))) ||
      !Array.isArray(proposedFiles) || proposedFiles.length < 1 || proposedFiles.length > task.writablePaths.length) {
    throw new AgentFabricError("AF_INVALID_STATE", "Model file proposal has unsupported structure");
  }
  const seen = new Set<string>();
  return proposedFiles.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new AgentFabricError("AF_INVALID_STATE", "Invalid model file proposal");
    }
    const file = item as Record<string, unknown>;
    if (Object.keys(file).sort().join(",") !== "content,path" ||
        typeof file.path !== "string" || !task.writablePaths.includes(file.path) ||
        seen.has(file.path.toLowerCase()) || typeof file.content !== "string" ||
        file.content.includes("\u0000")) {
      throw new AgentFabricError("AF_INVALID_STATE", "Model proposed an unauthorized file or content");
    }
    seen.add(file.path.toLowerCase());
    return { path: file.path, content: file.content };
  });
}

function checkedTarget(worktreeRoot: string, path: string): string {
  const target = resolve(worktreeRoot, path);
  const prefix = `${worktreeRoot}${process.platform === "win32" ? "\\" : "/"}`;
  if (!target.startsWith(prefix)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Model path escapes the isolated checkout");
  }
  let cursor = worktreeRoot;
  for (const segment of path.split("/")) {
    cursor = join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new AgentFabricError("AF_INVALID_STATE", "Model path traverses a symbolic link");
    }
  }
  return target;
}

export interface LocalPatchEvidence {
  worktreeRoot: string;
  baseCommit: string;
  changedPaths: readonly string[];
  diffDigest: Digest;
  diffBytes: number;
  diffPath: string;
  verification: "diff_check_passed" | "diff_check_failed";
}

/** Recheck the live checkout before showing or accepting its saved diff. */
export function verifyLocalPatchEvidence(patch: LocalPatchEvidence): void {
  const canonical = realpathSync(patch.worktreeRoot);
  const checkoutRoot = realpathSync(git(canonical, ["rev-parse", "--show-toplevel"]).trim());
  if (checkoutRoot !== canonical || git(canonical, ["rev-parse", "HEAD"]).trim() !== patch.baseCommit) {
    throw new AgentFabricError("AF_CONFLICT", "Approved patch checkout moved from its recorded base");
  }
  if (git(canonical, ["diff", "--cached", "--binary"]).length > 0 ||
      git(canonical, ["ls-files", "--others", "--exclude-standard"]).length > 0) {
    throw new AgentFabricError("AF_CONFLICT", "Patch checkout has unrecorded files or staged changes");
  }
  const diff = git(canonical, ["diff", "--binary"], patch.diffBytes + 1);
  if (sha256Digest(diff) !== patch.diffDigest ||
      sha256Digest(readFileSync(patch.diffPath, "utf8")) !== patch.diffDigest) {
    throw new AgentFabricError("AF_CONFLICT", "Live patch no longer matches its recorded diff");
  }
}

/** Observe an interrupted materialization without creating a checkout or writing files. */
export function readbackLocalCodingPatch(
  repositoryRoot: string, taskId: string,
  task: Readonly<LocalCodingTaskProposal>, modelText: string,
): LocalPatchEvidence {
  const files = validateModelFiles(modelText, task);
  const worktreePath = localFabricPath(repositoryRoot, "worktrees", taskId.replace(/^task:/u, ""));
  if (!existsSync(worktreePath)) throw new AgentFabricError("AF_CONFLICT", "Patch checkout was not materialized");
  const worktreeRoot = realpathSync(worktreePath);
  const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalized(realpathSync(git(worktreeRoot, ["rev-parse", "--show-toplevel"]).trim())) !== normalized(worktreeRoot) ||
      git(worktreeRoot, ["rev-parse", "HEAD"]).trim() !== task.baseCommit) {
    throw new AgentFabricError("AF_CONFLICT", "Patch checkout does not match its approved base");
  }
  for (const file of files) {
    const target = checkedTarget(worktreeRoot, file.path);
    if (!existsSync(target) || readFileSync(target, "utf8") !== file.content) {
      throw new AgentFabricError("AF_CONFLICT", "Patch checkout differs from the committed model result");
    }
  }
  if (git(worktreeRoot, ["diff", "--cached", "--binary"]).length > 0 ||
      git(worktreeRoot, ["ls-files", "--others", "--exclude-standard"]).length > 0) {
    throw new AgentFabricError("AF_CONFLICT", "Patch checkout has unrecorded files or staged changes");
  }
  const diff = git(worktreeRoot, ["diff", "--binary"], task.limits.maximumPatchBytes + 1);
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes === 0 || diffBytes > task.limits.maximumPatchBytes) {
    throw new AgentFabricError("AF_CONFLICT", "Patch readback is empty or exceeds the approved limit");
  }
  const changedPaths = git(worktreeRoot, ["diff", "--name-only"]).trim().split(/\r?\n/u).filter(Boolean);
  if (changedPaths.length !== files.length ||
      changedPaths.some((path) => !files.some((file) => file.path === path))) {
    throw new AgentFabricError("AF_CONFLICT", "Patch readback changed an unauthorized path");
  }
  const diffPath = localFabricPath(repositoryRoot, "artifacts", `${taskId.replace(/^task:/u, "")}.diff`);
  if (!existsSync(diffPath) || readFileSync(diffPath, "utf8") !== diff) {
    throw new AgentFabricError("AF_CONFLICT", "Patch artifact is missing or differs from checkout");
  }
  let verification: LocalPatchEvidence["verification"] = "diff_check_passed";
  try { git(worktreeRoot, ["diff", "--check"]); }
  catch { verification = "diff_check_failed"; }
  const patch: LocalPatchEvidence = { worktreeRoot, baseCommit: task.baseCommit,
    changedPaths, diffDigest: sha256Digest(diff), diffBytes, diffPath, verification };
  verifyLocalPatchEvidence(patch);
  return patch;
}

/** Apply a model's file proposal only inside a fresh checkout of the pinned commit. */
export function materializeLocalCodingPatch(
  repositoryRoot: string,
  taskId: string,
  task: Readonly<LocalCodingTaskProposal>,
  modelText: string,
): LocalPatchEvidence {
  const files = validateModelFiles(modelText, task);
  const worktreeRoot = localFabricPath(repositoryRoot, "worktrees", taskId.replace(/^task:/u, ""));
  const existing = existsSync(worktreeRoot);
  if (!existing) {
    mkdirSync(dirname(worktreeRoot), { recursive: true });
    git(repositoryRoot, ["worktree", "add", "--detach", "--", worktreeRoot, task.baseCommit]);
  }
  const canonical = realpathSync(worktreeRoot);
  const reportedRoot = realpathSync(git(canonical, ["rev-parse", "--show-toplevel"]).trim());
  if ((process.platform === "win32" ? reportedRoot.toLowerCase() : reportedRoot) !==
      (process.platform === "win32" ? canonical.toLowerCase() : canonical)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Isolated checkout root is not its own Git worktree");
  }
  if (git(canonical, ["rev-parse", "HEAD"]).trim() !== task.baseCommit) {
    throw new AgentFabricError("AF_INVALID_STATE", "Isolated checkout is not at the approved base commit");
  }
  for (const file of files) {
    const target = checkedTarget(canonical, file.path);
    if (existing) {
      if (!existsSync(target) || readFileSync(target, "utf8") !== file.content) {
        throw new AgentFabricError("AF_CONFLICT", "Existing checkout differs from the recorded model result");
      }
    } else {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, file.content, { flag: "w" });
    }
  }
  git(canonical, ["add", "-N", "--", ...files.map((file) => file.path)]);
  const diff = git(canonical, ["diff", "--binary", "--", ...files.map((file) => file.path)],
    task.limits.maximumPatchBytes + 1);
  const diffBytes = Buffer.byteLength(diff, "utf8");
  if (diffBytes === 0 || diffBytes > task.limits.maximumPatchBytes) {
    throw new AgentFabricError("AF_INVALID_STATE", "Resulting diff is empty or exceeds the approved patch limit");
  }
  const changedPaths = git(canonical, ["diff", "--name-only", "--", ...files.map((file) => file.path)])
    .trim().split(/\r?\n/u).filter(Boolean);
  if (changedPaths.length === 0 || changedPaths.some((path) => !task.writablePaths.includes(path))) {
    throw new AgentFabricError("AF_INVALID_STATE", "Resulting diff contains an unauthorized path");
  }
  const diffPath = localFabricPath(repositoryRoot, "artifacts", `${taskId.replace(/^task:/u, "")}.diff`);
  mkdirSync(dirname(diffPath), { recursive: true });
  if (existsSync(diffPath)) {
    if (readFileSync(diffPath, "utf8") !== diff) {
      throw new AgentFabricError("AF_CONFLICT", "Existing diff artifact differs from the model result");
    }
  } else {
    writeFileSync(diffPath, diff, { flag: "wx" });
  }
  if (sha256Digest(readFileSync(diffPath, "utf8")) !== sha256Digest(diff)) {
    throw new AgentFabricError("AF_INVALID_STATE", "Diff artifact failed readback");
  }
  let verification: LocalPatchEvidence["verification"] = "diff_check_passed";
  try {
    git(canonical, ["diff", "--check", "--", ...files.map((file) => file.path)]);
  } catch {
    verification = "diff_check_failed";
  }
  const patch = { worktreeRoot: canonical, baseCommit: task.baseCommit, changedPaths,
    diffDigest: sha256Digest(diff), diffBytes, diffPath, verification };
  verifyLocalPatchEvidence(patch);
  return patch;
}
