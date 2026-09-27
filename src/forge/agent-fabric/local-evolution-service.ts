import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createPgliteAdapter } from "../runtime/db/pglite-adapter.ts";
import type { DbAdapter } from "../runtime/db/adapter.ts";
import { digestCanonical, sha256Digest } from "./canonical.ts";
import { AgentFabricError } from "./errors.ts";
import { localEvolutionOwnerVerifier } from "./local-evolution-approval.ts";
import { LOCAL_ADAPTIVE_EXTENSION_KEY, assertLocalAdaptiveInputs,
  evaluateLocalAdaptiveProfile, parseLocalAdaptiveInputProfile } from "./local-evolution-profile.ts";
import { LocalEvolutionRegistry, type EvolutionChannel, type EvolutionDecisionAction,
  type EvolutionOwnerVerifier, type EvolutionVersionStatus, type FixedEvaluationSuite } from "./local-evolution-registry.ts";
import { localFabricPath } from "./local-paths.ts";
import type { Digest } from "./types.ts";

const MAX_MANIFEST = 16 * 1024;
const MAX_ARTIFACT = 1024 * 1024;
const suiteId = "local-adaptive-input-profile-v1";
const caseIds = ["artifact-integrity", "manifest-integrity", "manifest-contract",
  "profile-contract", "accept-valid-input", "reject-wrong-label", "reject-over-limit"] as const;
export const LOCAL_EVOLUTION_SUITE: FixedEvaluationSuite = {
  suiteId, caseIds, suiteDigest: digestCanonical({ suiteId, caseIds }, sha256Digest),
};

interface ExtensionManifest {
  schemaVersion: 1;
  extensionKey: string;
  artifactPath: string;
}

function invalid(message: string): never { throw new AgentFabricError("AF_INVALID_STATE", message); }
function digest(bytes: Buffer): Digest { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function strictManifest(bytes: Buffer): ExtensionManifest {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { return invalid("Extension manifest is invalid JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Extension manifest must be an object");
  const item = value as Partial<ExtensionManifest>;
  if (Object.keys(item).sort().join(",") !== "artifactPath,extensionKey,schemaVersion" ||
      item.schemaVersion !== 1 || typeof item.extensionKey !== "string" || item.extensionKey !== LOCAL_ADAPTIVE_EXTENSION_KEY ||
      typeof item.artifactPath !== "string" || !/^[A-Za-z0-9_./-]{1,256}$/u.test(item.artifactPath) ||
      item.artifactPath.split("/").some((part) => part === ".." || part === "." || part === "") ||
      !item.artifactPath.endsWith(".json")) {
    invalid("Extension manifest is outside the local v1 contract");
  }
  return item as ExtensionManifest;
}

function readBounded(path: string, max: number): Buffer {
  const size = statSync(path).size;
  if (!Number.isSafeInteger(size) || size < 1 || size > max || !statSync(path).isFile()) invalid("Extension file size or type is invalid");
  const bytes = readFileSync(path);
  if (bytes.length !== size) invalid("Extension file changed during read");
  return bytes;
}

function sourcePath(root: string, path: string): string {
  const full = realpathSync(resolve(root, path));
  const rel = relative(root, full);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) invalid("Extension source must be inside this repository");
  return full;
}

function storedPath(root: string, kind: "artifact" | "manifest", digestValue: Digest): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digestValue)) invalid("Invalid stored extension digest");
  return localFabricPath(root, "evolution", kind === "artifact" ? "artifacts" : "manifests", `${digestValue.slice(7)}.${kind === "artifact" ? "bin" : "json"}`);
}

function store(root: string, kind: "artifact" | "manifest", bytes: Buffer): Digest {
  const value = digest(bytes);
  const path = storedPath(root, kind, value);
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    try { writeFileSync(path, bytes, { flag: "wx", mode: 0o600 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  if (!readBounded(path, kind === "artifact" ? MAX_ARTIFACT : MAX_MANIFEST).equals(bytes)) {
    invalid("Stored immutable extension bytes differ from candidate");
  }
  return value;
}

export class LocalEvolutionService {
  private constructor(readonly repositoryRoot: string, private readonly adapter: DbAdapter,
    readonly registry: LocalEvolutionRegistry) {}

  static async open(repositoryRoot: string, ownerVerifier: EvolutionOwnerVerifier = localEvolutionOwnerVerifier()): Promise<LocalEvolutionService> {
    const root = realpathSync(repositoryRoot);
    const adapter = await createPgliteAdapter(localFabricPath(root, "evolution", "pglite"));
    const evaluator = async (version: { artifactDigest: Digest; manifestDigest: Digest; extensionKey: string }) => {
      let artifact: Buffer | null = null;
      let manifest: Buffer | null = null;
      try { artifact = readBounded(storedPath(root, "artifact", version.artifactDigest), MAX_ARTIFACT); } catch { /* fixed case fails */ }
      try { manifest = readBounded(storedPath(root, "manifest", version.manifestDigest), MAX_MANIFEST); } catch { /* fixed case fails */ }
      const artifactObserved = artifact ? digest(artifact) : sha256Digest("missing-artifact");
      const manifestObserved = manifest ? digest(manifest) : sha256Digest("missing-manifest");
      let contract = false;
      if (manifest) {
        try { contract = strictManifest(manifest).extensionKey === version.extensionKey; } catch { /* fixed case fails */ }
      }
      const profile = artifact ? evaluateLocalAdaptiveProfile(artifact) :
        { contract: false, acceptsValid: false, rejectsWrongLabel: false, rejectsOverLimit: false };
      return [
        { caseId: caseIds[0], passed: artifactObserved === version.artifactDigest, evidenceDigest: artifactObserved },
        { caseId: caseIds[1], passed: manifestObserved === version.manifestDigest, evidenceDigest: manifestObserved },
        { caseId: caseIds[2], passed: contract, evidenceDigest: digestCanonical({ manifestDigest: manifestObserved, extensionKey: version.extensionKey, contract }, sha256Digest) },
        ...([
          ["profile-contract", profile.contract],
          ["accept-valid-input", profile.acceptsValid],
          ["reject-wrong-label", profile.rejectsWrongLabel],
          ["reject-over-limit", profile.rejectsOverLimit],
        ] as const).map(([caseId, passed]) => ({
          caseId, passed, evidenceDigest: digestCanonical({ artifactDigest: artifactObserved, caseId, passed }, sha256Digest),
        })),
      ];
    };
    try { return new LocalEvolutionService(root, adapter, new LocalEvolutionRegistry({
      adapter, suite: LOCAL_EVOLUTION_SUITE, evaluator, ownerVerifier,
    })); } catch (error) { await adapter.close(); throw error; }
  }

  async close(): Promise<void> { await this.adapter.close(); }

  async register(manifestPath: string): Promise<EvolutionVersionStatus> {
    const manifest = readBounded(sourcePath(this.repositoryRoot, manifestPath), MAX_MANIFEST);
    const parsed = strictManifest(manifest);
    const artifact = readBounded(sourcePath(this.repositoryRoot, parsed.artifactPath), MAX_ARTIFACT);
    const artifactDigest = store(this.repositoryRoot, "artifact", artifact);
    const manifestDigest = store(this.repositoryRoot, "manifest", manifest);
    const version = await this.registry.register({ extensionKey: parsed.extensionKey, artifactDigest, manifestDigest });
    return (await this.registry.status(version.versionId))!;
  }

  async status(versionId: string): Promise<EvolutionVersionStatus> {
    const result = await this.registry.status(versionId);
    if (!result) throw new AgentFabricError("AF_NOT_FOUND", "Extension version not found");
    return result;
  }

  async evaluate(versionId: string): Promise<EvolutionVersionStatus> {
    await this.registry.evaluate(versionId);
    return this.status(versionId);
  }

  async decide(action: EvolutionDecisionAction, versionId: string): Promise<EvolutionVersionStatus> {
    // Adaptive execution holds this same lock from profile readback through worker
    // dispatch. A concurrent promotion or revocation must not pass between those
    // two operations and silently change what the owner approved.
    const lockPath = localFabricPath(this.repositoryRoot, "adaptive-lock");
    let descriptor: number;
    try { descriptor = openSync(lockPath, "wx", 0o600); }
    catch { throw new AgentFabricError("AF_CONFLICT", "Adaptive owner is busy; inspect adaptive status before changing its profile"); }
    try {
      const before = await this.status(versionId);
      const channel: EvolutionChannel = action === "canary" ? "canary" : "stable";
      const expected = await this.registry.selected(before.version.extensionKey, channel);
      await this.registry.decide(action, versionId, expected);
      return this.status(versionId);
    } finally { closeSync(descriptor); unlinkSync(lockPath); }
  }

  /** Loading returns verified bytes only for the currently selected, evaluated, non-revoked version. */
  async loadSelected(extensionKey: string, channel: EvolutionChannel): Promise<{
    versionId: string; artifact: Buffer; manifest: ExtensionManifest;
  }> {
    const versionId = await this.registry.selected(extensionKey, channel);
    if (!versionId) throw new AgentFabricError("AF_CONFLICT", "No selected extension version on this channel");
    const status = await this.status(versionId);
    if (status.revoked || !status.channels.includes(channel) || status.evaluation?.state !== "passed" ||
        status.evaluation.suiteDigest !== LOCAL_EVOLUTION_SUITE.suiteDigest) {
      throw new AgentFabricError("AF_CONFLICT", "Extension version is not loadable");
    }
    const artifact = readBounded(storedPath(this.repositoryRoot, "artifact", status.version.artifactDigest), MAX_ARTIFACT);
    const manifestBytes = readBounded(storedPath(this.repositoryRoot, "manifest", status.version.manifestDigest), MAX_MANIFEST);
    if (digest(artifact) !== status.version.artifactDigest || digest(manifestBytes) !== status.version.manifestDigest) {
      invalid("Stored immutable extension bytes changed");
    }
    const manifest = strictManifest(manifestBytes);
    if (manifest.extensionKey !== extensionKey) invalid("Stored extension manifest key changed");
    // Guard a revocation racing with a file read before handing bytes to the caller.
    if (await this.registry.selected(extensionKey, channel) !== versionId) {
      throw new AgentFabricError("AF_CONFLICT", "Extension selection changed during load");
    }
    return { versionId, artifact, manifest };
  }

  /** Bind one attempt to the selected immutable profile and narrow only its input data. */
  async resolveSelectedLocalAdaptiveInputs(channel: EvolutionChannel, attemptId: string,
    inventory: string, constraints: string): Promise<{
    versionId: string; inventory: string; constraints: string;
  }> {
    const loaded = await this.loadSelected(LOCAL_ADAPTIVE_EXTENSION_KEY, channel);
    const profile = parseLocalAdaptiveInputProfile(loaded.artifact);
    assertLocalAdaptiveInputs(profile, inventory, constraints);
    const binding = await this.registry.bindAttempt(attemptId, LOCAL_ADAPTIVE_EXTENSION_KEY, channel);
    if (binding.versionId !== loaded.versionId) {
      throw new AgentFabricError("AF_CONFLICT", "Selected profile changed before attempt binding");
    }
    return { versionId: binding.versionId, inventory, constraints };
  }
}
