import { nodeFileSystem } from "../fs/index.ts";
import type { FileSystem } from "../fs/index.ts";

/**
 * Thin async I/O helpers for the emitter, delegating to an injectable
 * {@link FileSystem}. The async signatures are preserved so callers in
 * `emit.ts` are unchanged; tests can pass an `InMemoryFileSystem` to run the
 * emitter without touching disk. Atomic write semantics live in
 * {@link NodeFileSystem.writeText}.
 */
export async function readTextFileIfExists(
  absolutePath: string,
  fs: FileSystem = nodeFileSystem,
): Promise<string | null> {
  return fs.readText(absolutePath);
}

export async function writeFileAtomic(
  absolutePath: string,
  content: string,
  fs: FileSystem = nodeFileSystem,
): Promise<void> {
  fs.writeText(absolutePath, content);
}

export async function removeFileIfExists(
  absolutePath: string,
  fs: FileSystem = nodeFileSystem,
): Promise<boolean> {
  const existed = fs.exists(absolutePath);
  if (existed) {
    fs.remove(absolutePath);
  }
  return existed;
}
