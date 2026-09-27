import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { localFabricPath } from "./local-paths.ts";
import type { Digest } from "./types.ts";

const MAX_FILES = 24;
const MAX_FILE_BYTES = 32 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024;
const MAX_MEMORY_BYTES = 512 * 1024;
const MAX_ENTRIES = 128;
const MAX_NOTE_BYTES = 2 * 1024;
const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const COMMIT_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/u;

function fail(message: string): never {
  throw new AgentFabricError("AF_INVALID_STATE", `Local intelligence: ${message}`);
}

function git(root: string, args: readonly string[], maxBuffer = MAX_TOTAL_BYTES + 4096): Buffer {
  try {
    return execFileSync("git", [...args], {
      cwd: root, windowsHide: true, timeout: 10_000,
      maxBuffer, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return fail(`Git ${args[0] ?? "operation"} failed`);
  }
}

function utf8(bytes: Buffer): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return fail("source is not UTF-8 text"); }
}

function hash(bytes: Buffer): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function rootOf(repositoryRoot: string): string {
  const root = realpathSync(repositoryRoot);
  const reported = realpathSync(utf8(git(root, ["rev-parse", "--show-toplevel"])).trim());
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  if (normalize(root) !== normalize(reported)) fail("repository root must be the Git checkout root");
  return root;
}

function sourcePath(value: string): string {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value, "utf8") > 240 ||
      value.normalize("NFC") !== value || value.startsWith("/") || /[\\:*?"<>|\u0000-\u001f\u007f]/u.test(value)) {
    fail("invalid allowlisted source path");
  }
  const segments = value.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === ".." ||
        [".git", ".forge", ".ssh", "node_modules", "_generated"].includes(segment.toLowerCase()) ||
        /^\.env(?:\.|$)/iu.test(segment) ||
        [".npmrc", ".pypirc", "forge.lock", "id_rsa", "id_ed25519"].includes(segment.toLowerCase()) ||
        /\.(?:pem|key|p12|pfx)$/iu.test(segment) || segment.endsWith(".") || segment.endsWith(" ") ||
        Buffer.byteLength(segment, "utf8") > 100 ||
        /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(segment)) {
      fail("forbidden allowlisted source path");
    }
  }
  return value;
}

function liveFile(root: string, path: string): Buffer {
  let cursor = root;
  for (const segment of path.split("/")) {
    cursor = join(cursor, segment);
    const stat = lstatSync(cursor, { throwIfNoEntry: false });
    if (!stat || stat.isSymbolicLink()) fail("source path missing or traverses a symbolic link");
  }
  const target = resolve(root, path);
  const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
  const stat = lstatSync(target);
  if (!normalize(target).startsWith(`${normalize(root)}${process.platform === "win32" ? "\\" : "/"}`) ||
      !stat.isFile()) fail("source is not a regular file in the checkout");
  if (stat.size > MAX_FILE_BYTES) fail("source file exceeds byte limit");
  const bytes = readFileSync(target);
  if (bytes.length > MAX_FILE_BYTES) fail("source file exceeds byte limit");
  return bytes;
}

export interface LocalSourceFile {
  path: string;
  bytes: number;
  content: string;
  contentDigest: Digest;
}

/** Source text is evidence, never an instruction or an authorization. */
export interface LocalSourceSnapshot {
  schemaVersion: 1;
  repositoryRoot: string;
  commit: string;
  files: readonly LocalSourceFile[];
  snapshotDigest: Digest;
  authority: "untrusted_source";
}

function snapshotBody(snapshot: LocalSourceSnapshot): Omit<LocalSourceSnapshot, "snapshotDigest"> {
  return {
    schemaVersion: snapshot.schemaVersion, repositoryRoot: snapshot.repositoryRoot,
    commit: snapshot.commit, files: snapshot.files, authority: snapshot.authority,
  };
}

/** Capture only explicitly allowlisted, tracked UTF-8 files at the current exact HEAD. */
export function captureLocalSourceSnapshot(repositoryRoot: string, allowlistedPaths: readonly string[]): LocalSourceSnapshot {
  const root = rootOf(repositoryRoot);
  if (!Array.isArray(allowlistedPaths) || allowlistedPaths.length < 1 || allowlistedPaths.length > MAX_FILES) {
    fail("source allowlist count is outside limits");
  }
  const paths = allowlistedPaths.map(sourcePath);
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) fail("duplicate source path");
  const commit = utf8(git(root, ["rev-parse", "HEAD"])).trim();
  if (!COMMIT_RE.test(commit)) fail("HEAD is not a full commit ID");
  let total = 0;
  const files = paths.map((path): LocalSourceFile => {
    const committed = git(root, ["show", `${commit}:${path}`], MAX_FILE_BYTES + 1);
    if (committed.length > MAX_FILE_BYTES) fail("committed source file exceeds byte limit");
    const live = liveFile(root, path);
    // Git's CRLF checkout conversion preserves the committed text. Accept only
    // that conventional conversion; all other live-content changes invalidate it.
    const committedText = utf8(committed);
    if (!committed.equals(live) && utf8(live).replace(/\r\n/gu, "\n") !== committedText) {
      fail("allowlisted source changed in the working tree");
    }
    total += committed.length;
    if (total > MAX_TOTAL_BYTES) fail("source snapshot exceeds byte limit");
    return { path, bytes: committed.length, content: committedText, contentDigest: hash(committed) };
  });
  const body = { schemaVersion: 1 as const, repositoryRoot: root, commit, files, authority: "untrusted_source" as const };
  return { ...body, snapshotDigest: digestCanonical(body, sha256Digest) };
}

/** Recheck the digest, the exact HEAD, and every live allowlisted file before use. */
export function assertCurrentLocalSourceSnapshot(snapshot: LocalSourceSnapshot): void {
  if (snapshot.schemaVersion !== 1 || snapshot.authority !== "untrusted_source" ||
      !DIGEST_RE.test(snapshot.snapshotDigest) ||
      digestCanonical(snapshotBody(snapshot), sha256Digest) !== snapshot.snapshotDigest) {
    fail("source snapshot digest or schema is invalid");
  }
  const current = captureLocalSourceSnapshot(snapshot.repositoryRoot, snapshot.files.map((file) => file.path));
  if (current.commit !== snapshot.commit || current.snapshotDigest !== snapshot.snapshotDigest) {
    fail("source snapshot is stale");
  }
}

export interface LocalMemoryEntry {
  id: string;
  sourceSnapshotDigest: Digest;
  text: string;
  createdAt: number;
  expiresAt: number;
  authority: "untrusted_memory";
}

interface MemoryFile {
  schemaVersion: 1;
  entries: LocalMemoryEntry[];
  digest: Digest;
}

function memoryDigest(entries: readonly LocalMemoryEntry[]): Digest {
  return digestCanonical({ schemaVersion: 1, entries }, sha256Digest);
}

/** Local single-process store. The trusted owner boundary must control calls to this class. */
export class LocalPrivateIntelligenceMemory {
  private readonly root: string;
  private readonly path: string;
  private readonly now: () => number;

  constructor(repositoryRoot: string, now: () => number = Date.now) {
    this.root = rootOf(repositoryRoot);
    this.path = localFabricPath(this.root, "private-memory.json");
    this.now = now;
  }

  private read(): LocalMemoryEntry[] {
    if (!existsSync(this.path)) return [];
    const stat = lstatSync(this.path);
    if (!stat.isFile()) fail("memory store is not a regular file");
    if (stat.size > MAX_MEMORY_BYTES) fail("memory store exceeds byte limit");
    const bytes = readFileSync(this.path);
    if (bytes.length > MAX_MEMORY_BYTES) fail("memory store exceeds byte limit");
    let parsed: MemoryFile;
    try { parsed = JSON.parse(utf8(bytes)) as MemoryFile; }
    catch { return fail("memory store is malformed"); }
    if (!parsed || typeof parsed !== "object" || parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES ||
        !DIGEST_RE.test(parsed.digest) || memoryDigest(parsed.entries) !== parsed.digest) {
      fail("memory store digest or schema is invalid");
    }
    const ids = new Set<string>();
    for (const entry of parsed.entries) {
      if (!entry || !/^memory:[0-9a-f]{32}$/u.test(entry.id) ||
          ids.has(entry.id) ||
          !DIGEST_RE.test(entry.sourceSnapshotDigest) ||
          typeof entry.text !== "string" || Buffer.byteLength(entry.text, "utf8") > MAX_NOTE_BYTES ||
          !Number.isSafeInteger(entry.createdAt) || !Number.isSafeInteger(entry.expiresAt) ||
          entry.expiresAt <= entry.createdAt || entry.authority !== "untrusted_memory") {
        fail("memory entry is malformed");
      }
      ids.add(entry.id);
    }
    return parsed.entries;
  }

  private write(entries: LocalMemoryEntry[]): void {
    const parent = dirname(this.path);
    mkdirSync(parent, { recursive: true, mode: 0o700 });
    localFabricPath(this.root, "private-memory.json");
    const data = stableStringify({ schemaVersion: 1, entries, digest: memoryDigest(entries) });
    if (Buffer.byteLength(data, "utf8") > MAX_MEMORY_BYTES) fail("memory store exceeds byte limit");
    const temp = localFabricPath(this.root, `private-memory-${randomBytes(8).toString("hex")}.tmp`);
    try {
      writeFileSync(temp, data, { flag: "wx", mode: 0o600 });
      renameSync(temp, this.path);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }

  remember(snapshot: LocalSourceSnapshot, text: string, retentionMs: number): LocalMemoryEntry {
    assertCurrentLocalSourceSnapshot(snapshot);
    if (typeof text !== "string" || !text.trim() || text.includes("\u0000") ||
        Buffer.byteLength(text, "utf8") > MAX_NOTE_BYTES) fail("memory text is empty or too large");
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > MAX_RETENTION_MS) {
      fail("retention must be explicit and at most 30 days");
    }
    const createdAt = this.now();
    if (!Number.isSafeInteger(createdAt) || createdAt < 0) fail("invalid local clock");
    if (!Number.isSafeInteger(createdAt + retentionMs)) fail("retention expiry exceeds local clock range");
    const entries = this.read().filter((entry) => entry.expiresAt > createdAt);
    if (entries.length >= MAX_ENTRIES) fail("memory entry limit reached");
    const entry: LocalMemoryEntry = {
      id: `memory:${randomBytes(16).toString("hex")}`, sourceSnapshotDigest: snapshot.snapshotDigest,
      text, createdAt, expiresAt: createdAt + retentionMs, authority: "untrusted_memory",
    };
    entries.push(entry);
    this.write(entries);
    return entry;
  }

  recall(snapshot: LocalSourceSnapshot): readonly LocalMemoryEntry[] {
    assertCurrentLocalSourceSnapshot(snapshot);
    const now = this.now();
    return this.read().filter((entry) => entry.expiresAt > now &&
      entry.sourceSnapshotDigest === snapshot.snapshotDigest);
  }

  /** Explicit deletion does not require the original source snapshot to remain current. */
  forget(id: string): boolean {
    const entries = this.read();
    const remaining = entries.filter((entry) => entry.id !== id);
    if (remaining.length === entries.length) return false;
    this.write(remaining);
    return true;
  }

  purgeExpired(): number {
    const entries = this.read();
    const remaining = entries.filter((entry) => entry.expiresAt > this.now());
    if (remaining.length !== entries.length) this.write(remaining);
    return entries.length - remaining.length;
  }

  clear(): number {
    const entries = this.read();
    if (entries.length > 0) this.write([]);
    return entries.length;
  }
}
