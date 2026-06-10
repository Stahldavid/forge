import {
  FORGE_AUTH_CLAIM_MISSING,
  FORGE_AUTH_DEV_HEADERS_IN_PRODUCTION,
  FORGE_AUTH_DISABLED,
  FORGE_AUTH_INVALID_AUDIENCE,
  FORGE_AUTH_INVALID_ISSUER,
  FORGE_AUTH_INVALID_TOKEN,
  FORGE_AUTH_JWKS_FAILED,
  FORGE_AUTH_MISSING_TOKEN,
  FORGE_AUTH_MODE_INVALID,
  FORGE_AUTH_TENANT_MISSING,
  FORGE_AUTH_TOKEN_EXPIRED,
} from "../../compiler/diagnostics/codes.ts";

export type ForgeAuthDiagnosticCode =
  | typeof FORGE_AUTH_MISSING_TOKEN
  | typeof FORGE_AUTH_INVALID_TOKEN
  | typeof FORGE_AUTH_INVALID_ISSUER
  | typeof FORGE_AUTH_INVALID_AUDIENCE
  | typeof FORGE_AUTH_TOKEN_EXPIRED
  | typeof FORGE_AUTH_JWKS_FAILED
  | typeof FORGE_AUTH_CLAIM_MISSING
  | typeof FORGE_AUTH_TENANT_MISSING
  | typeof FORGE_AUTH_DEV_HEADERS_IN_PRODUCTION
  | typeof FORGE_AUTH_MODE_INVALID
  | typeof FORGE_AUTH_DISABLED;

export class ForgeAuthError extends Error {
  code: ForgeAuthDiagnosticCode;
  status: number;

  constructor(
    code: ForgeAuthDiagnosticCode,
    message: string,
    options: { status?: number; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ForgeAuthError";
    this.code = code;
    this.status = options.status ?? 401;
    if (options.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}
