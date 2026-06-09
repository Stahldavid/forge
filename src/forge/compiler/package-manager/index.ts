export type {
  PackageManagerAdapter,
  DryRunAddResult,
  CreatePackageManagerAdapterOptions,
} from "./adapter.ts";
export {
  createPackageManagerAdapter,
  detectAndCreatePackageManagerAdapter,
  dryRunRecipeFallbackMessage,
  detectPackageManager,
  detectPackageManagerFromLockfiles,
  getLockfileForPm,
  getLockfileCandidates,
  parsePackageManagerField,
  LOCKFILE_PM_MAP,
  buildAddCommand,
  parsePackageName,
  readInstalledVersion,
  defaultCommandExecutor,
  PackageManagerCommandError,
} from "./adapter.ts";
export type { CommandExecutor, CommandRunResult } from "./executor.ts";
