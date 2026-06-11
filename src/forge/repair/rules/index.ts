import { createDiagnostic } from "../../compiler/diagnostics/create.ts";
import { hashStable } from "../../compiler/primitives/hash.ts";
import type {
  FailureInput,
  FailureKind,
  RepairAffected,
  RepairConfidence,
  RepairDiagnosis,
  RepairRule,
  SuggestedRepair,
} from "../types.ts";

const REPAIR_VERSION = "repair-0.1.0";

function emptyAffected(): RepairAffected {
  return {
    files: [],
    commands: [],
    queries: [],
    liveQueries: [],
    actions: [],
    workflows: [],
    tables: [],
    policies: [],
    components: [],
    packages: [],
  };
}

function push(values: string[], value: string | undefined): void {
  if (value && !values.includes(value)) {
    values.push(value);
  }
}

function affectedFromDiagnostics(input: FailureInput): RepairAffected {
  const affected = emptyAffected();
  const haystack = `${input.stdout}\n${input.stderr}\n${input.diagnostics.map((d) => `${d.message} ${d.file ?? ""}`).join("\n")}`;
  for (const diagnostic of input.diagnostics) {
    push(affected.files, diagnostic.file);
    const policy = diagnostic.message.match(/\b([a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+)\b/i)?.[1];
    if (policy) push(affected.policies, policy);
  }
  const command = haystack.match(/\bcommand\s+([a-zA-Z][a-zA-Z0-9_]*)\b/)?.[1] ??
    haystack.match(/src\/commands\/([a-zA-Z][a-zA-Z0-9_]*)\.ts/)?.[1];
  push(affected.commands, command);
  const query = haystack.match(/\bquery\s+([a-zA-Z][a-zA-Z0-9_]*)\b/)?.[1] ??
    haystack.match(/src\/queries\/([a-zA-Z][a-zA-Z0-9_]*)\.ts/)?.[1];
  if (query?.toLowerCase().startsWith("live")) push(affected.liveQueries, query);
  else push(affected.queries, query);
  const pkg = haystack.match(/\b(stripe|posthog|sentry|openai|anthropic|ai|jose)\b/i)?.[1];
  push(affected.packages, pkg);
  affected.files.sort();
  affected.commands.sort();
  affected.queries.sort();
  affected.liveQueries.sort();
  affected.policies.sort();
  affected.packages.sort();
  return affected;
}

function diagnosis(input: FailureInput, args: {
  failureKind: FailureKind;
  code: string;
  summary: string;
  likelyCause: string;
  suggestedRepairs: SuggestedRepair[];
  recommendedChecks?: string[];
  confidence: RepairConfidence;
}): RepairDiagnosis {
  const affected = affectedFromDiagnostics(input);
  const id = `repair_${hashStable(`${args.code}:${args.summary}:${input.source.kind}:${input.source.id ?? ""}:${input.source.file ?? ""}`).slice(0, 12)}`;
  const diagnostics =
    input.diagnostics.length > 0
      ? input.diagnostics
      : [
          createDiagnostic({
            severity: "error",
            code: args.code,
            message: args.summary,
            file: input.source.file,
          }),
        ];
  return {
    schemaVersion: "0.1.0",
    repairVersion: REPAIR_VERSION,
    id,
    failureKind: args.failureKind,
    source: input.source,
    diagnostics,
    summary: args.summary,
    likelyCause: args.likelyCause,
    affected,
    suggestedRepairs: args.suggestedRepairs,
    recommendedChecks: args.recommendedChecks ?? [
      "forge generate",
      "forge check",
      "forge verify --changed",
      "forge verify --strict",
    ],
    confidence: args.confidence,
  };
}

function hasCode(input: FailureInput, ...codes: string[]): boolean {
  const text = `${input.stdout}\n${input.stderr}\n${input.diagnostics.map((d) => `${d.code}\n${d.message}`).join("\n")}`;
  return codes.some((code) => text.includes(code));
}

function firstPolicy(input: FailureInput): string {
  const text = `${input.stdout}\n${input.stderr}\n${input.diagnostics.map((d) => d.message).join("\n")}`;
  return text.match(/\b([a-z][a-z0-9_-]+\.[a-z][a-z0-9_-]+)\b/i)?.[1] ?? "resource.action";
}

function firstSecret(input: FailureInput): string {
  const text = `${input.stdout}\n${input.stderr}\n${input.diagnostics.map((d) => d.message).join("\n")}`;
  return text
    .match(/\b[A-Z][A-Z0-9_]{2,}\b/g)
    ?.find((candidate) => !candidate.startsWith("FORGE_")) ?? "SECRET_NAME";
}

function firstCommand(input: FailureInput): string {
  const affected = affectedFromDiagnostics(input);
  return affected.commands[0] ?? "commandName";
}

function firstPackage(input: FailureInput): string {
  const affected = affectedFromDiagnostics(input);
  return affected.packages[0] ?? "package-name";
}

export const repairRules: RepairRule[] = [
  {
    id: "generated-drift",
    matches: (input) => hasCode(input, "FORGE_DRIFT", "FORGE_ORPHANED_GENERATED_FILE"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "generated-drift",
        code: "FORGE_DRIFT",
        summary: "Generated artifacts are stale.",
        likelyCause: "Source files or compiler inputs changed without regenerating Forge artifacts.",
        confidence: "high",
        suggestedRepairs: [
          {
            id: "run-generate",
            kind: "run-command",
            title: "Regenerate Forge artifacts",
            description: "Run the deterministic generator to update generated files and forge.lock.",
            command: "forge generate",
            confidence: "high",
            risk: { level: "low", reasons: ["deterministic generated output"] },
            requiresConfirmation: false,
          },
        ],
      }),
  },
  {
    id: "runtime-guard",
    matches: (input) => hasCode(input, "FORGE_GUARD_VIOLATION", "FORGE_RUNTIME_GUARD_BLOCKED"),
    diagnose: (input) => {
      const command = firstCommand(input);
      const pkg = firstPackage(input);
      return diagnosis(input, {
        failureKind: "runtime-guard",
        code: "FORGE_GUARD_VIOLATION",
        summary: `A forbidden package or capability is reachable from deterministic runtime code.`,
        likelyCause: "A network, secret, AI, or server-only package was imported from a command/query/liveQuery path.",
        confidence: command !== "commandName" ? "medium" : "low",
        suggestedRepairs: [
          {
            id: "extract-action",
            kind: "refactor",
            title: "Move side effect to an action",
            description: "Make the command emit an event and move the package call to an action.",
            command: `forge refactor extract-action ${command} --package ${pkg} --event ${command}.requested`,
            confidence: command !== "commandName" ? "medium" : "low",
            risk: { level: "medium", reasons: ["changes runtime side-effect boundary"] },
            requiresConfirmation: true,
          },
        ],
      });
    },
  },
  {
    id: "policy-auth",
    matches: (input) =>
      hasCode(input, "FORGE_POLICY_UNKNOWN", "FORGE_POLICY_MISSING", "FORGE_POLICY_DENIED", "FORGE_AUTH_TENANT_MISSING", "FORGE_AUTH_INVALID_TOKEN"),
    diagnose: (input) => {
      const policy = firstPolicy(input);
      return diagnosis(input, {
        failureKind: "policy-auth",
        code: "FORGE_POLICY_UNKNOWN",
        summary: `Policy or auth configuration needs attention for ${policy}.`,
        likelyCause: "A runtime entry references a missing policy, an auth context is incomplete, or the caller role is denied.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "make-policy",
            kind: "make",
            title: "Create missing policy",
            description: "Create the policy with conservative owner/admin/member roles, then review access intentionally.",
            command: `forge make policy ${policy} --roles owner,admin,member --apply --yes`,
            confidence: "medium",
            risk: { level: "high", reasons: ["permission changes require human review"] },
            requiresConfirmation: true,
          },
          {
            id: "simulate-policy",
            kind: "run-command",
            title: "Simulate policy",
            description: "Check whether the expected role is allowed before changing permissions.",
            command: `forge policy simulate ${policy} --role member`,
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      });
    },
  },
  {
    id: "secrets",
    matches: (input) =>
      hasCode(input, "FORGE_SECRET_DIRECT_PROCESS_ENV", "FORGE_SECRET_MISSING", "FORGE_SECRET_FORBIDDEN_CONTEXT"),
    diagnose: (input) => {
      const secret = firstSecret(input);
      return diagnosis(input, {
        failureKind: "secrets",
        code: "FORGE_SECRET_DIRECT_PROCESS_ENV",
        summary: `Secret/config usage is unsafe or missing for ${secret}.`,
        likelyCause: "Code reads process.env directly, accesses secrets in a forbidden runtime, or the environment lacks a required secret.",
        confidence: "high",
        suggestedRepairs: [
          {
            id: "replace-process-env",
            kind: "refactor",
            title: "Replace process.env access",
            description: "Use ctx.secrets where a runtime context is available.",
            command: `forge refactor replace-process-env ${secret} --yes`,
            confidence: "high",
            risk: { level: "low", reasons: ["mechanical secret access replacement"] },
            requiresConfirmation: true,
          },
          {
            id: "check-secrets",
            kind: "run-command",
            title: "Check secrets",
            description: "Validate secret registry and missing environment names.",
            command: "forge secrets check",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      });
    },
  },
  {
    id: "ai",
    matches: (input) => hasCode(input, "FORGE_AI_FORBIDDEN_CONTEXT", "FORGE_AI_SECRET_MISSING", "FORGE_AI_PROVIDER_UNKNOWN", "FORGE_AI_GENERATION_FAILED"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "ai",
        code: "FORGE_AI_FORBIDDEN_CONTEXT",
        summary: "AI usage failed or appears in a forbidden runtime context.",
        likelyCause: "AI calls belong in actions/workflows/endpoints/server, not deterministic commands/queries/liveQueries.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "ai-check",
            kind: "run-command",
            title: "Check AI providers",
            description: "Validate provider configuration and mock mode.",
            command: "forge ai check",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
          {
            id: "move-ai",
            kind: "manual",
            title: "Move AI call to action/workflow",
            description: "Store AI output in the database from an action/workflow; queries should read the stored result.",
            confidence: "medium",
            risk: { level: "medium", reasons: ["changes runtime architecture"] },
            requiresConfirmation: true,
          },
        ],
      }),
  },
  {
    id: "query-readonly",
    matches: (input) =>
      hasCode(input, "FORGE_QUERY_WRITE_FORBIDDEN", "FORGE_QUERY_EMIT_FORBIDDEN", "FORGE_QUERY_SECRET_FORBIDDEN", "FORGE_QUERY_AI_FORBIDDEN"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "query-readonly",
        code: "FORGE_QUERY_WRITE_FORBIDDEN",
        summary: "A query performs work that is forbidden in read-only runtime.",
        likelyCause: "Queries and liveQueries must be deterministic reads without writes, emits, secrets, AI, or integrations.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "make-command",
            kind: "make",
            title: "Move mutation to a command",
            description: "Create a command for writes or event emission, then keep the query read-only.",
            command: "forge make command <name> --table <table> --policy <policy>",
            confidence: "medium",
            risk: { level: "medium", reasons: ["requires choosing command/table/policy names"] },
            requiresConfirmation: true,
          },
        ],
      }),
  },
  {
    id: "livequery",
    matches: (input) =>
      hasCode(input, "FORGE_LIVE_INVALIDATION_MISSING", "FORGE_LIVE_RERUN_FAILED", "FORGE_LIVE_SNAPSHOT_TOO_LARGE", "FORGE_LIVEQUERY_UNKNOWN", "FORGE_UI_LIVE_UPDATE_TIMEOUT"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "livequery-reactivity",
        code: "FORGE_LIVE_INVALIDATION_MISSING",
        summary: "LiveQuery reactivity or subscription delivery failed.",
        likelyCause: "A write was not tracked, the liveQuery dependency is unknown, the tenant scope mismatched, or the snapshot is too large.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "live-debug",
            kind: "run-command",
            title: "Inspect live subscriptions",
            description: "Inspect liveQuery state and invalidation history.",
            command: "forge live invalidations --json",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      }),
  },
  {
    id: "workflow",
    matches: (input) => hasCode(input, "FORGE_WORKFLOW_STEP_FAILED", "FORGE_WORKFLOW_STEP_DEAD", "FORGE_WORKFLOW_RUN_NOT_FOUND"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "workflow",
        code: "FORGE_WORKFLOW_STEP_FAILED",
        summary: "Workflow run or step failed.",
        likelyCause: "A workflow step threw, missed a secret, received invalid input, or exhausted retries.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "workflow-inspect",
            kind: "run-command",
            title: "Inspect workflow run",
            description: "Inspect step state, attempts, traceId, and last error.",
            command: "forge workflow inspect <runId> --json",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      }),
  },
  {
    id: "outbox",
    matches: (input) => hasCode(input, "FORGE_OUTBOX_PROCESS_FAILED", "FORGE_OUTBOX_DELIVERY_NOT_FOUND", "dead-letter", "delivery dead"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "outbox",
        code: "FORGE_OUTBOX_PROCESS_FAILED",
        summary: "Outbox delivery failed or is dead-lettered.",
        likelyCause: "The subscribed action failed repeatedly, often due to secret, integration, payload, or network configuration.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "outbox-retry",
            kind: "run-command",
            title: "Retry delivery after fixing action",
            description: "Retry the delivery once the underlying action/integration issue is fixed.",
            command: "forge outbox retry <deliveryId>",
            confidence: "medium",
            risk: { level: "medium", reasons: ["replays a side-effect delivery"] },
            requiresConfirmation: true,
          },
        ],
      }),
  },
  {
    id: "package-upgrade",
    matches: (input) =>
      hasCode(input, "FORGE_DEPS_API_BREAKING_CHANGE", "FORGE_DEPS_REMOVED_EXPORT_USED", "FORGE_DEPS_SIGNATURE_CHANGED_USED", "FORGE_DEPS_APPLY_FAILED"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "package-upgrade",
        code: "FORGE_DEPS_API_BREAKING_CHANGE",
        summary: "Package upgrade introduced an API or runtime compatibility issue.",
        likelyCause: "The upgrade plan contains removed exports, changed signatures, new capabilities, or failing callsites.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "deps-check",
            kind: "run-command",
            title: "Inspect package upgrade risk",
            description: "Re-run the upgrade checker and inspect affected callsites.",
            command: "forge deps upgrade-check --json",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      }),
  },
  {
    id: "frontend-client",
    matches: (input) => hasCode(input, "server-only", "client", "ForgeError", "React", "FORGE_UI_EXPECTATION_FAILED", "FORGE_UI_SELECTOR_NOT_FOUND", "FORGE_UI_CONSOLE_ERROR", "FORGE_UI_NETWORK_ERROR"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "frontend-client",
        code: "FORGE_REPAIR_FRONTEND_CLIENT",
        summary: "Frontend/client failure needs client-safe API or hook review.",
        likelyCause: "A frontend component may import server-only code or use Forge client hooks without the expected provider/auth context.",
        confidence: "low",
        suggestedRepairs: [
          {
            id: "client-safe-imports",
            kind: "manual",
            title: "Use generated client-safe entrypoints",
            description: "Import from generated client/react surfaces instead of server adapters.",
            confidence: "low",
            risk: { level: "medium", reasons: ["requires component-specific review"] },
            requiresConfirmation: true,
          },
        ],
      }),
  },
  {
    id: "release-deploy",
    matches: (input) => hasCode(input, "FORGE_RELEASE_", "FORGE_SOURCEMAP_", "self-host", "deploy"),
    diagnose: (input) =>
      diagnosis(input, {
        failureKind: "release-deploy",
        code: "FORGE_RELEASE_ARTIFACT_MISSING",
        summary: "Release or deployment verification failed.",
        likelyCause: "Release artifacts, source maps, self-host files, or environment configuration are missing or stale.",
        confidence: "medium",
        suggestedRepairs: [
          {
            id: "release-check",
            kind: "run-command",
            title: "Run release and self-host checks",
            description: "Inspect release/deploy generated artifacts and runtime health assumptions.",
            command: "forge release check",
            confidence: "high",
            risk: { level: "low", reasons: ["read-only diagnostic command"] },
            requiresConfirmation: false,
          },
        ],
      }),
  },
];

export function explainDiagnostic(code: string): string {
  const explanations: Record<string, string> = {
    FORGE_DRIFT: "Generated artifacts are stale. Run forge generate, then forge generate --check.",
    FORGE_GUARD_VIOLATION: "A package or capability is used in a runtime context where it is forbidden. Move side effects to actions/workflows.",
    FORGE_POLICY_UNKNOWN: "A runtime entry references a missing policy. Create or correct the policy, then simulate expected roles.",
    FORGE_POLICY_DENIED: "The caller auth context does not satisfy the policy. Fix test auth or intentionally update policy roles.",
    FORGE_SECRET_DIRECT_PROCESS_ENV: "Code reads process.env directly. Use ctx.secrets/ctx.config in allowed runtime contexts.",
    FORGE_AI_FORBIDDEN_CONTEXT: "AI is being used in a deterministic context. Move AI calls to action/workflow/server runtime.",
    FORGE_WORKFLOW_STEP_FAILED: "A workflow step failed. Inspect the workflow run and trace before retrying.",
    FORGE_OUTBOX_PROCESS_FAILED: "An outbox delivery failed. Inspect the subscribed action and retry after fixing the cause.",
    FORGE_DEPS_API_BREAKING_CHANGE: "A package upgrade changed API/runtime compatibility. Inspect the upgrade plan and affected callsites.",
  };
  return explanations[code] ?? `${code}: no specific repair explanation is registered yet. Run forge repair diagnose --diagnostic ${code} --json for generic guidance.`;
}
