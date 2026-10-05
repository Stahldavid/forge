import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import { promisify } from "node:util";
import { stableStringify } from "./canonical.ts";
import { attachedFail, attachedScope, type AttachedSnapshot } from "./attached-task-contract.ts";

const exec = promisify(execFile);
export function attachedDigest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
async function git(root: string, args: string[]): Promise<string> {
  const result = await exec("git", args, { cwd: root, windowsHide: true, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 10000 });
  return result.stdout;
}
export async function attachedHead(root: string): Promise<string> { return (await git(root, ["rev-parse", "HEAD"])).trim(); }
export async function assertAttachedSafePath(root: string, target: string): Promise<void> {
  const rel = relative(resolve(root), resolve(target));
  if (rel.startsWith("..") || resolve(target) === resolve(root)) attachedFail("AF_ATTACHED_PATH", "Path escapes repository");
  let path = resolve(root);
  for (const part of rel.split(/[\\/]/u)) {
    path = join(path, part);
    try { if ((await lstat(path)).isSymbolicLink()) attachedFail("AF_ATTACHED_PATH", "Symlink paths are unsupported"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
}
/** Hashes actual working files, including nonignored untracked files and deletions. */
export async function captureAttachedSnapshot(root: string, scopeInput: string[], baseHead: string): Promise<AttachedSnapshot> {
  const scope = attachedScope(scopeInput);
  const currentHead = await attachedHead(root);
  const listing = await git(root, ["--literal-pathspecs", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...scope]);
  const paths = [...new Set(listing.split("\0").filter(Boolean))].filter((path) => !path.startsWith(".forge/local/")).sort();
  if (paths.length > 4000) attachedFail("AF_ATTACHED_SNAPSHOT_LIMIT", "Scope exceeds 4000 files");
  let size = 0;
  const files: AttachedSnapshot["files"] = [];
  for (const path of paths) {
    const absolute = join(root, path);
    await assertAttachedSafePath(root, absolute);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile()) attachedFail("AF_ATTACHED_PATH", `Unsupported snapshot entry: ${path}`);
      size += stat.size;
      if (stat.size > 16 * 1024 * 1024 || size > 128 * 1024 * 1024) attachedFail("AF_ATTACHED_SNAPSHOT_LIMIT", "Snapshot byte limit exceeded");
      const bytes = await readFile(absolute);
      const after = await lstat(absolute);
      if (after.isSymbolicLink() || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) attachedFail("AF_ATTACHED_SNAPSHOT_CHANGED", `File changed during capture: ${path}`);
      files.push({ path, digest: attachedDigest(bytes), mode: stat.mode & 0o111 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      files.push({ path, digest: null, mode: null });
    }
  }
  if (currentHead !== await attachedHead(root)) attachedFail("AF_ATTACHED_SNAPSHOT_CHANGED", "Git HEAD changed during capture");
  const content = { baseHead, currentHead, scope, files };
  return { ...content, digest: attachedDigest(stableStringify(content)) };
}
