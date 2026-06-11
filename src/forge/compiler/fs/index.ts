export type { FileSystem, DirEntry, FileStat } from "./types.ts";
export { NodeFileSystem } from "./node.ts";
export { InMemoryFileSystem } from "./memory.ts";
export {
  createProfiledFileSystem,
  formatFileSystemProfile,
  getFileSystemProfile,
  isForgeProfileEnabled,
  resetFileSystemProfile,
} from "./profile.ts";

import { NodeFileSystem } from "./node.ts";
import {
  createProfiledFileSystem,
  isForgeProfileEnabled,
  resetFileSystemProfile,
} from "./profile.ts";

resetFileSystemProfile();
const baseFileSystem = new NodeFileSystem();
export const nodeFileSystem = isForgeProfileEnabled()
  ? createProfiledFileSystem(baseFileSystem)
  : baseFileSystem;
