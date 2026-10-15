import { readRepositoryManifest } from "../repository-manifest/index.ts";
import { analyzeRepository } from "../repository-analysis/analyze.ts";
import { repositoryContext } from "../repository-analysis/context.ts";
import { readRepositorySnapshot } from "../repository-analysis/context.ts";
import { existsSync } from "node:fs";
import { readRuntimeObservation, runtimeSourceDigest, selectRuntimeObservation } from "../repository-analysis/runtime-observation.ts";
import { join } from "node:path";
import { selectRepositoryContext } from "../repository-analysis/retrieval.ts";
import { selectRepositoryChecks } from "../repository-analysis/check-selection.ts";
import { repositoryQualitySummary, type RepositoryQualitySummary } from "../repository-analysis/quality.ts";

export interface FabricRepositoryContextMetadata {
  provider: "repository";
  phase: "prepared-input";
  status: "ready" | "unavailable";
  sourceRoot: string;
  cloneRoot: string;
  snapshotId?: string;
  diagnostics: string[];
  quality?: RepositoryQualitySummary;
  runtime?: { reportId: string; environmentId: string; phase: "source-observed-matching-input" };
}

/** Optional static maps, taken from the clone after upstream composition and preparation.
 * Nothing is written: an analysis cache in the clone would violate artifact write scope.
 * Suggested checks are never executed here and maps never relax publication obligations.
 */
export async function prepareFabricRepositoryContext(sourceRoot: string, cloneRoot: string, query: string, scope: string[] = []): Promise<{ metadata: FabricRepositoryContextMetadata; prompt: string } | undefined> {
  let loaded: ReturnType<typeof readRepositoryManifest>;
  try { loaded = readRepositoryManifest(cloneRoot); }
  catch { loaded = { manifest: null, diagnostics: ["Repository manifest cannot be read safely"] }; }
  const { manifest, diagnostics } = loaded;
  if (!manifest && !diagnostics.length) return undefined;
  // JSON parser diagnostics can echo source values. Public worker metadata needs only
  // an actionable status; detailed manifest validation is a separate user operation.
  const metadata: FabricRepositoryContextMetadata = { provider: "repository", phase: "prepared-input", status: "unavailable", sourceRoot, cloneRoot, diagnostics: diagnostics.length ? ["Repository manifest missing, invalid or unsafe"] : [] };
  if (!manifest) return { metadata, prompt: "Repository maps unavailable: invalid manifest. Inspect the code directly; no analysis result is claimed." };
  try {
    const snapshot = await analyzeRepository(cloneRoot, manifest, { write: false, factsCacheRoot: join(sourceRoot, ".forge", "repository") });
    // Executor prompts are natural-language instructions, not CAIR query programs.
    const context = await repositoryContext(cloneRoot, snapshot, `locate ${query.slice(0, 1000)}`, { snapshotId: snapshot.snapshotId, maxChars: 12000, limit: 20, includeSource: false });
    metadata.snapshotId = snapshot.snapshotId;
    metadata.diagnostics = context.diagnostics.slice(0, 20).map(item => item.slice(0, 512));
    if (!context.ok) return { metadata, prompt: "Repository maps unavailable or stale. Inspect current clone files directly; do not reuse source-checkout analysis." };
    metadata.quality = repositoryQualitySummary(snapshot);
    const selection = selectRepositoryContext(snapshot, query, { writeScope: scope, maxChars: 10000, maxNodes: 30, maxEdges: 30 });
    const checks = selectRepositoryChecks(snapshot, { scope, nodeIds: selection.nodes.map(node => node.id) }).checks.slice(0, 10);
    // An observation is supplementary evidence about the source input, never an
    // assertion that the SDK worker ran the application. Upstream composition or
    // another manifest/scenario must invalidate reuse even when task files match.
    let runtime: unknown;
    if (existsSync(join(sourceRoot, ".forge/repository/runtime-observation.json"))) {
      try {
        const sourceSnapshot = readRepositorySnapshot(sourceRoot);
        if (sourceSnapshot) {
          const report = readRuntimeObservation(sourceRoot, sourceSnapshot);
          if (report.binding.manifestHash === snapshot.manifestHash && report.binding.scenarioHash === snapshot.scenarioHash
            && runtimeSourceDigest(cloneRoot, manifest) === report.binding.inputDigest) {
            runtime = selectRuntimeObservation(report, { query, scope: [...new Set(selection.nodes.map(node => node.component))], maxChars: 4000 });
            metadata.runtime = { reportId: report.reportId, environmentId: report.environmentId, phase: "source-observed-matching-input" };
          }
        }
      } catch { /* Missing/stale observations cannot downgrade valid static maps. */ }
    }
    const packet = { ...selection, cloneRoot, quality: metadata.quality, coverage: { found: snapshot.coverage.found, analyzed: snapshot.coverage.analyzed,
      unsupported: snapshot.coverage.unsupported, errors: snapshot.coverage.errors, limitations: snapshot.coverage.limitations.slice(0, 10) },
      suggestedCheckIds: checks.map(check => ({ id: check.id, component: check.component })), suggestedChecks: checks, runtime };
    if (JSON.stringify(packet).length > 16000 && runtime) { delete packet.runtime; delete metadata.runtime; packet.truncated = true; }
    while (JSON.stringify(packet).length > 16000 && packet.suggestedChecks.length) { packet.suggestedChecks.pop(); packet.suggestedCheckIds.pop(); packet.truncated = true; }
    const serialized = JSON.stringify(packet);
    const text = serialized.length <= 16000 ? serialized : JSON.stringify({ snapshotId: snapshot.snapshotId, cloneRoot, truncated: true, reason: "Context packet exceeded budget; inspect clone directly" });
    metadata.status = "ready";
    return { metadata, prompt: `Repository analysis of THIS prepared clone (static evidence, not executed coverage). Optional runtime evidence was observed in an independent source copy with matching input, not executed in this worker clone; it describes only its recorded scenario and time. Source project identity: ${sourceRoot}. Ready means input prepared, not semantic completeness. Snapshot handles apply only to this snapshot. Read-only neighbors never extend write scope. Suggested checks are informational; only authorized workflow executors run checks. Maps do not replace required review, verification or file scope.\n${text}` };
  } catch {
    // Analysis is an optional aid. Do not expose parser exceptions or claim a fallback
    // graph from the source checkout; the existing worker and publication gates remain.
    metadata.status = "unavailable";
    delete metadata.quality;
    delete metadata.runtime;
    metadata.diagnostics = ["Repository analysis unavailable in this prepared clone"];
    return { metadata, prompt: "Repository analysis failed in this clone. Inspect the current files directly; no map evidence is available." };
  }
}
