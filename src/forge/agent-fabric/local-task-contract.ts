import { digestCanonical, sha256Digest, stableStringify } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import type { Digest } from "./types.ts";
import type { LocalVerificationCommand } from "./local-verification.ts";

/** Untrusted request data. This does not grant authority or start a task. */
export interface LocalCodingTaskProposal {
  schemaVersion: 1;
  repositoryId: string;
  baseCommit: string;
  goal: string;
  acceptanceCriteria: readonly string[];
  nonObjectives: readonly string[];
  sourcePaths: readonly string[];
  writablePaths: readonly string[];
  requestedModelTargetId: string;
  verification?: { imageId: string; commands: readonly LocalVerificationCommand[] };
  limits: {
    maximumAttempts: number;
    maximumWallClockMs: number;
    maximumOutputTokens: number;
    maximumContextBytes: number;
    maximumPatchBytes: number;
    expiresAt: number;
  };
}

export interface ValidatedLocalCodingTaskProposal {
  proposal: Readonly<LocalCodingTaskProposal>;
  proposalDigest: Digest;
}

const MAX_PROPOSAL_BYTES = 32 * 1024;
const MAX_CONTEXT_BYTES = 32 * 1024;
const MAX_PATCH_BYTES = 48 * 1024;

function invalid(field: string): never {
  throw new AgentFabricError("AF_INVALID_STATE", `Invalid local coding task proposal field: ${field}`);
}

function record(value: unknown, field: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field);
  const item = value as Record<string, unknown>;
  const actual = Object.keys(item);
  if (actual.length !== keys.length ||
      keys.some((key) => !Object.hasOwn(item, key)) ||
      actual.some((key) => !keys.includes(key))) invalid(field);
  return item;
}

function boundedText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
      Buffer.byteLength(value, "utf8") > maxBytes || /[\u0000-\u001f\u007f]/u.test(value)) invalid(field);
  return value;
}

function identifier(value: unknown, field: string): string {
  const text = boundedText(value, field, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text)) invalid(field);
  return text;
}

function textList(value: unknown, field: string, minimum: number, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(field);
  return value.map((item, index) => boundedText(item, `${field}[${index}]`, 512));
}

function relativeFilePath(value: unknown, field: string): string {
  const path = boundedText(value, field, 240);
  if (path.normalize("NFC") !== path || path.startsWith("/") ||
      /[\\:*?"<>|]/u.test(path)) invalid(field);
  const segments = path.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." ||
      segment === ".." || [".git", ".forge", ".ssh", "node_modules", "_generated"].includes(segment.toLowerCase()) ||
      /^\.env(?:\.|$)/iu.test(segment) ||
      [".npmrc", ".pypirc", "forge.lock", "id_rsa", "id_ed25519"].includes(segment.toLowerCase()) ||
      /\.(?:pem|key|p12|pfx)$/iu.test(segment) ||
      segment.endsWith(".") || segment.endsWith(" ") ||
      Buffer.byteLength(segment, "utf8") > 100 ||
      /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu.test(segment))) invalid(field);
  return path;
}

function pathList(value: unknown, field: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) invalid(field);
  const paths = value.map((item, index) => relativeFilePath(item, `${field}[${index}]`));
  if (new Set(paths.map((path) => path.toLowerCase())).size !== paths.length) invalid(field);
  return paths;
}

function positiveInteger(value: unknown, field: string, maximum: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0 || value > maximum) invalid(field);
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validate and digest only a proposal. Trusted repository resolution, owner admission,
 * path readback, resource reservation, and execution happen at later boundaries.
 */
export function validateLocalCodingTaskProposal(input: unknown): ValidatedLocalCodingTaskProposal {
  const canonical = stableStringify(input);
  if (Buffer.byteLength(canonical, "utf8") > MAX_PROPOSAL_BYTES) invalid("proposalBytes");
  const decoded = JSON.parse(canonical) as Record<string, unknown>;
  const hasVerification = decoded !== null && typeof decoded === "object" && !Array.isArray(decoded) &&
    Object.hasOwn(decoded, "verification");
  const raw = record(decoded, "proposal", [
    "schemaVersion", "repositoryId", "baseCommit", "goal", "acceptanceCriteria",
    "nonObjectives", "sourcePaths", "writablePaths", "requestedModelTargetId", "limits",
    ...(hasVerification ? ["verification"] : []),
  ]);
  if (raw.schemaVersion !== 1) invalid("schemaVersion");
  if (typeof raw.baseCommit !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(raw.baseCommit)) {
    invalid("baseCommit");
  }
  const limits = record(raw.limits, "limits", [
    "maximumAttempts", "maximumWallClockMs", "maximumOutputTokens",
    "maximumContextBytes", "maximumPatchBytes", "expiresAt",
  ]);
  let verification: LocalCodingTaskProposal["verification"];
  if (Object.hasOwn(raw, "verification")) {
    const spec = record(raw.verification, "verification", ["imageId", "commands"]);
    if (typeof spec.imageId !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(spec.imageId)) invalid("verification.imageId");
    if (!Array.isArray(spec.commands) || spec.commands.length < 2 || spec.commands.length > 4) invalid("verification.commands");
    const commands = spec.commands.map((value: unknown, index: number): LocalVerificationCommand => {
      if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`verification.commands[${index}]`);
      const item = value as Record<string, unknown>;
      if (item.kind === "git-diff-check") {
        record(item, `verification.commands[${index}]`, ["kind", "timeoutMs"]);
        return { kind: "git-diff-check", timeoutMs: positiveInteger(item.timeoutMs, `verification.commands[${index}].timeoutMs`, 60_000) };
      }
      if (item.kind === "node-test-file") {
        record(item, `verification.commands[${index}]`, ["kind", "path", "timeoutMs"]);
        return { kind: "node-test-file", path: relativeFilePath(item.path, `verification.commands[${index}].path`),
          timeoutMs: positiveInteger(item.timeoutMs, `verification.commands[${index}].timeoutMs`, 60_000) };
      }
      invalid(`verification.commands[${index}].kind`);
    });
    if (commands[0]?.kind !== "git-diff-check" || commands.slice(1).some((command) => command.kind !== "node-test-file") ||
        new Set(commands.slice(1).map((command) => (command as { path: string }).path.toLowerCase())).size !== commands.length - 1) {
      invalid("verification.commands");
    }
    verification = { imageId: spec.imageId, commands };
  }
  const proposal: LocalCodingTaskProposal = {
    schemaVersion: 1,
    repositoryId: identifier(raw.repositoryId, "repositoryId"),
    baseCommit: raw.baseCommit,
    goal: boundedText(raw.goal, "goal", 4_000),
    acceptanceCriteria: textList(raw.acceptanceCriteria, "acceptanceCriteria", 1, 16),
    nonObjectives: textList(raw.nonObjectives, "nonObjectives", 0, 16),
    sourcePaths: pathList(raw.sourcePaths, "sourcePaths", 24),
    writablePaths: pathList(raw.writablePaths, "writablePaths", 12),
    requestedModelTargetId: identifier(raw.requestedModelTargetId, "requestedModelTargetId"),
    ...(verification ? { verification } : {}),
    limits: {
      maximumAttempts: positiveInteger(limits.maximumAttempts, "limits.maximumAttempts", 3),
      maximumWallClockMs: positiveInteger(limits.maximumWallClockMs, "limits.maximumWallClockMs", 120_000),
      maximumOutputTokens: positiveInteger(limits.maximumOutputTokens, "limits.maximumOutputTokens", 4_096),
      maximumContextBytes: positiveInteger(limits.maximumContextBytes, "limits.maximumContextBytes", MAX_CONTEXT_BYTES),
      maximumPatchBytes: positiveInteger(limits.maximumPatchBytes, "limits.maximumPatchBytes", MAX_PATCH_BYTES),
      expiresAt: positiveInteger(limits.expiresAt, "limits.expiresAt", Number.MAX_SAFE_INTEGER),
    },
  };
  const proposalDigest = digestCanonical(proposal, sha256Digest);
  return { proposal: freezeDeep(proposal), proposalDigest };
}
