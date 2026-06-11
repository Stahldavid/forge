/**
 * NodeFileSystem — the production {@link FileSystem} backed by `node:fs`.
 *
 * This is the single place in the codebase that should reach for synchronous
 * `node:fs` primitives. Everything else depends on the {@link FileSystem}
 * interface so it can be unit-tested against {@link InMemoryFileSystem}.
 */
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import type { DirEntry, FileSystem } from "./types.ts";

export class NodeFileSystem implements FileSystem {
  readText(path: string): string | null {
    try {
      return readFileSync(path, "utf8");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "EISDIR") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Atomic write: stages content in a sibling temp file and renames it into
   * place, so a crash mid-write never leaves a partially written artifact.
   */
  writeText(path: string, content: string): void {
    const directory = dirname(path);
    mkdirSync(directory, { recursive: true });
    const temporaryPath = join(
      directory,
      `.${basename(path)}.${process.pid}.tmp`,
    );
    try {
      writeFileSync(temporaryPath, content, "utf8");
      renameSync(temporaryPath, path);
    } catch (error) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // Ignore cleanup failures while surfacing the original write error.
      }
      throw error;
    }
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  readDir(path: string): DirEntry[] {
    if (!existsSync(path)) {
      return [];
    }
    return readdirSync(path, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  mkdirp(path: string): void {
    mkdirSync(path, { recursive: true });
  }

  rename(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true });
    renameSync(from, to);
  }

  copy(from: string, to: string): void {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, force: true });
  }

  appendText(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, content, "utf8");
  }

  makeTempDir(prefix: string): string {
    mkdirSync(dirname(prefix), { recursive: true });
    return mkdtempSync(prefix);
  }

  remove(path: string): void {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  }

  isDirectory(path: string): boolean {
    return existsSync(path) && statSync(path).isDirectory();
  }
}

/** Shared singleton for production call sites that want a default backend. */
export const nodeFileSystem = new NodeFileSystem();
