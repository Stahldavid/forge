import type { DirEntry, FileStat, FileSystem } from "./types.ts";

export interface FileSystemProfile {
  readText: number;
  readTextBytes: number;
  writeText: number;
  writeTextBytes: number;
  readDir: number;
  stat: number;
  exists: number;
}

function emptyProfile(): FileSystemProfile {
  return {
    readText: 0,
    readTextBytes: 0,
    writeText: 0,
    writeTextBytes: 0,
    readDir: 0,
    stat: 0,
    exists: 0,
  };
}

let activeProfile: FileSystemProfile | null = null;

export function isForgeProfileEnabled(): boolean {
  return process.env.FORGE_PROFILE === "1" || process.env.FORGE_PROFILE === "true";
}

export function getFileSystemProfile(): FileSystemProfile | null {
  return activeProfile;
}

export function resetFileSystemProfile(): void {
  activeProfile = isForgeProfileEnabled() ? emptyProfile() : null;
}

export function formatFileSystemProfile(profile: FileSystemProfile): string {
  return [
    "forge fs profile:",
    `  readText: ${profile.readText} (${profile.readTextBytes} bytes)`,
    `  writeText: ${profile.writeText} (${profile.writeTextBytes} bytes)`,
    `  readDir: ${profile.readDir}`,
    `  stat: ${profile.stat}`,
    `  exists: ${profile.exists}`,
  ].join("\n");
}

export function createProfiledFileSystem(inner: FileSystem): FileSystem {
  if (!activeProfile) {
    activeProfile = emptyProfile();
  }

  const profile = activeProfile;

  return {
    readText(path: string): string | null {
      const content = inner.readText(path);
      profile.readText += 1;
      if (content !== null) {
        profile.readTextBytes += content.length;
      }
      return content;
    },
    writeText(path: string, content: string): void {
      profile.writeText += 1;
      profile.writeTextBytes += content.length;
      inner.writeText(path, content);
    },
    exists(path: string): boolean {
      profile.exists += 1;
      return inner.exists(path);
    },
    readDir(path: string): DirEntry[] {
      profile.readDir += 1;
      return inner.readDir(path);
    },
    mkdirp(path: string): void {
      inner.mkdirp(path);
    },
    rename(from: string, to: string): void {
      inner.rename(from, to);
    },
    copy(from: string, to: string): void {
      inner.copy(from, to);
    },
    appendText(path: string, content: string): void {
      profile.writeText += 1;
      profile.writeTextBytes += content.length;
      inner.appendText(path, content);
    },
    makeTempDir(prefix: string): string {
      return inner.makeTempDir(prefix);
    },
    remove(path: string): void {
      inner.remove(path);
    },
    isDirectory(path: string): boolean {
      profile.exists += 1;
      return inner.isDirectory(path);
    },
    stat(path: string): FileStat | null {
      profile.stat += 1;
      return inner.stat(path);
    },
  };
}
