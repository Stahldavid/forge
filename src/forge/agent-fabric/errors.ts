export type AgentFabricErrorCode =
  | "AF_CANONICALIZATION_FAILED"
  | "AF_CONFLICT"
  | "AF_DUPLICATE_ID"
  | "AF_GRANT_REJECTED"
  | "AF_INVALID_EVENT"
  | "AF_INVALID_PLAN"
  | "AF_INVALID_STATE"
  | "AF_NOT_FOUND"
  | "AF_PERMIT_REJECTED"
  | "AF_RESOURCE_EXHAUSTED"
  | "AF_STALE_ATTEMPT";

export class AgentFabricError extends Error {
  readonly code: AgentFabricErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: AgentFabricErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "AgentFabricError";
    this.code = code;
    this.details = details;
  }
}

export function isAgentFabricError(error: unknown): error is AgentFabricError {
  return error instanceof AgentFabricError;
}
