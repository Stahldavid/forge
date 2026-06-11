/**
 * FileSystem — a minimal, injectable I/O abstraction.
 *
 * ForgeOS leaf code calls `node:fs` synchronous APIs directly, which makes pure
 * unit testing impossible without touching the real disk or monkey-patching
 * modules. This interface captures exactly the operations the compiler and
 * authoring tools need, so production code can run on {@link NodeFileSystem}
 * while tests run on an in-memory backend.
 *
 * The surface is intentionally synchronous to match the existing call sites and
 * the deterministic, single-shot nature of the generators.
 */

export interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileStat {
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
  isFile: boolean;
}

export interface FileSystem {
  /** Return file contents as UTF-8, or `null` when the path does not exist. */
  readText(path: string): string | null;
  /** Write UTF-8 contents, creating parent directories as needed. */
  writeText(path: string, content: string): void;
  /** Whether a file or directory exists at the path. */
  exists(path: string): boolean;
  /** List immediate entries of a directory. Returns `[]` for a missing dir. */
  readDir(path: string): DirEntry[];
  /** Create a directory (and parents). No-op if it already exists. */
  mkdirp(path: string): void;
  /** Rename/move a file or directory. */
  rename(from: string, to: string): void;
  /** Recursively copy a file or directory tree (overwrites the target). */
  copy(from: string, to: string): void;
  /** Append UTF-8 text, creating the file and parent directories as needed. */
  appendText(path: string, content: string): void;
  /** Create a unique temporary directory for `prefix`; returns its path. */
  makeTempDir(prefix: string): string;
  /** Remove a file or directory tree. No-op if the path is absent. */
  remove(path: string): void;
  /** Whether the path exists and is a directory. */
  isDirectory(path: string): boolean;
  /** Metadata for an existing path, or `null` when absent. */
  stat(path: string): FileStat | null;
}
