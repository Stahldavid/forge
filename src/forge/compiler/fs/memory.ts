/**
 * InMemoryFileSystem — a test/double {@link FileSystem} with no disk access.
 *
 * Paths are normalised to forward slashes and stored flat. Directories are
 * tracked both explicitly (via {@link InMemoryFileSystem.mkdirp}) and implicitly
 * (any ancestor of a written file). This mirrors the observable behaviour of
 * {@link NodeFileSystem} closely enough for compiler/authoring unit tests.
 */
import type { DirEntry, FileSystem } from "./types.ts";

function normalize(path: string): string {
  const slashed = path.replace(/\\/g, "/").replace(/\/+/g, "/");
  if (slashed.length > 1 && slashed.endsWith("/")) {
    return slashed.slice(0, -1);
  }
  return slashed;
}

function parentOf(path: string): string | null {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) {
    return null;
  }
  return path.slice(0, idx);
}

export class InMemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();
  private tempCounter = 0;

  constructor(initial?: Record<string, string>) {
    if (initial) {
      for (const [path, content] of Object.entries(initial)) {
        this.writeText(path, content);
      }
    }
  }

  /** Snapshot of all stored files keyed by normalised path. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }

  private addAncestors(path: string): void {
    let parent = parentOf(path);
    while (parent !== null) {
      this.dirs.add(parent);
      parent = parentOf(parent);
    }
  }

  readText(path: string): string | null {
    const key = normalize(path);
    return this.files.has(key) ? (this.files.get(key) as string) : null;
  }

  writeText(path: string, content: string): void {
    const key = normalize(path);
    this.files.set(key, content);
    this.addAncestors(key);
  }

  exists(path: string): boolean {
    const key = normalize(path);
    return this.files.has(key) || this.isDirectory(key);
  }

  isDirectory(path: string): boolean {
    const key = normalize(path);
    if (this.dirs.has(key)) {
      return true;
    }
    const prefix = `${key}/`;
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  readDir(path: string): DirEntry[] {
    const key = normalize(path);
    const prefix = key === "" ? "" : `${key}/`;
    const childDirs = new Set<string>();
    const childFiles = new Set<string>();

    const consider = (entry: string, isFile: boolean): void => {
      if (!entry.startsWith(prefix) || entry === key) {
        return;
      }
      const rest = entry.slice(prefix.length);
      if (rest === "") {
        return;
      }
      const slash = rest.indexOf("/");
      if (slash === -1) {
        if (isFile) {
          childFiles.add(rest);
        } else {
          childDirs.add(rest);
        }
      } else {
        childDirs.add(rest.slice(0, slash));
      }
    };

    for (const file of this.files.keys()) {
      consider(file, true);
    }
    for (const dir of this.dirs) {
      consider(dir, false);
    }

    const entries: DirEntry[] = [];
    for (const name of childDirs) {
      entries.push({ name, isDirectory: true, isFile: false });
    }
    for (const name of childFiles) {
      if (!childDirs.has(name)) {
        entries.push({ name, isDirectory: false, isFile: true });
      }
    }
    return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  mkdirp(path: string): void {
    const key = normalize(path);
    this.dirs.add(key);
    this.addAncestors(key);
  }

  rename(from: string, to: string): void {
    const fromKey = normalize(from);
    const toKey = normalize(to);

    if (this.files.has(fromKey)) {
      this.files.set(toKey, this.files.get(fromKey) as string);
      this.files.delete(fromKey);
      this.addAncestors(toKey);
      return;
    }

    // Directory move: relocate every descendant file and dir.
    const prefix = `${fromKey}/`;
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) {
        const moved = `${toKey}/${file.slice(prefix.length)}`;
        this.files.set(moved, this.files.get(file) as string);
        this.files.delete(file);
        this.addAncestors(moved);
      }
    }
    for (const dir of [...this.dirs]) {
      if (dir === fromKey || dir.startsWith(prefix)) {
        this.dirs.delete(dir);
        const moved = dir === fromKey ? toKey : `${toKey}/${dir.slice(prefix.length)}`;
        this.dirs.add(moved);
      }
    }
  }

  remove(path: string): void {
    const key = normalize(path);
    this.files.delete(key);
    this.dirs.delete(key);
    const prefix = `${key}/`;
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) {
        this.files.delete(file);
      }
    }
    for (const dir of [...this.dirs]) {
      if (dir.startsWith(prefix)) {
        this.dirs.delete(dir);
      }
    }
  }

  copy(from: string, to: string): void {
    const fromKey = normalize(from);
    const toKey = normalize(to);

    if (this.files.has(fromKey)) {
      this.writeText(toKey, this.files.get(fromKey) as string);
      return;
    }

    const prefix = `${fromKey}/`;
    for (const file of [...this.files.keys()]) {
      if (file.startsWith(prefix)) {
        const copied = `${toKey}/${file.slice(prefix.length)}`;
        this.writeText(copied, this.files.get(file) as string);
      }
    }
    this.mkdirp(toKey);
  }

  appendText(path: string, content: string): void {
    const existing = this.readText(path) ?? "";
    this.writeText(path, existing + content);
  }

  makeTempDir(prefix: string): string {
    this.tempCounter += 1;
    const dir = `${normalize(prefix)}${this.tempCounter.toString(36)}${Date.now().toString(36)}`;
    this.mkdirp(dir);
    return dir;
  }
}
