export {
  FORGE_DUP_SYMBOL,
  FORGE_DRIFT,
  FORGE_PKG_NO_TYPES,
  FORGE_GUARD_VIOLATION,
  FORGE_SANDBOX_LIMIT,
  FORGE_SECRET_LEAK,
  FORGE_ORPHANED_GENERATED_FILE,
  FORGE_SANDBOX_ABNORMAL,
  FORGE_DUP_RUNTIME_ENTRY,
  FORGE_RUNTIME_UNRESOLVABLE,
  FORGE_RUNTIME_NOT_FOUND,
  FORGE_RUNTIME_GUARD_BLOCKED,
  DIAGNOSTIC_CODES,
} from "./codes.ts";
export type { DiagnosticCode } from "./codes.ts";
export {
  createDiagnostic,
  forgeDupSymbol,
  forgeDrift,
  forgePkgNoTypes,
  forgeGuardViolation,
  forgeSandboxLimit,
  forgeSandboxAbnormal,
  forgeSecretLeak,
  forgeOrphanedGeneratedFile,
  forgeWriteError,
} from "./create.ts";
export type { DiagnosticInput } from "./create.ts";
