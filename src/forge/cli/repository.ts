import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { readRepositoryManifest, resolveRepositoryRoot, validateRepositoryManifest } from "../repository-manifest/index.ts";
import { discoverRepository } from "../repository-analysis/scanner.ts";
import { analyzeRepository } from "../repository-analysis/analyze.ts";
import { readRepositorySnapshot, repositoryContext } from "../repository-analysis/context.ts";

export interface RepositoryCliOptions {
  action: "discover" | "analyze" | "context";
  cwd: string;
  root?: string;
  projectId?: string;
  manifestPath?: string;
  cacheRoot?: string;
  write: boolean;
  json: boolean;
  query?: string;
  snapshotId?: string;
  limit?: number;
  maxChars?: number;
  cursor?: string;
  output?: string;
}

export async function runRepositoryCommand(options: RepositoryCliOptions): Promise<{ exitCode: number; [key: string]: unknown }> {
  try {
    if (!["discover", "analyze", "context"].includes(options.action)) throw new Error("Unsupported repository action");
    if (options.action === "context" && options.write) throw new Error("Repository context is read-only");
    if (options.output && (options.action !== "discover" || !options.write)) throw new Error("--output requires discovery with --write");
    const root = await resolveRepositoryRoot(options);
    if (options.action === "discover") {
      const manifest = discoverRepository(root);
      const checked = validateRepositoryManifest(manifest);
      if (!checked.manifest) throw new Error(`No valid supported repository proposal: ${checked.diagnostics.join("; ")}`);
      if (options.write) {
        const file = resolve(options.output ?? resolve(root, "forge.manifest.json"));
        if (existsSync(file)) throw new Error("Discovery never overwrites an existing manifest; choose a new --output");
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
      }
      return { exitCode: 0, ok: true, root, manifest, wroteManifest: options.write };
    }
    const loaded = readRepositoryManifest(root, { manifestPath: options.manifestPath });
    if (!loaded.manifest || loaded.diagnostics.length) throw new Error(loaded.diagnostics.join("; ") || "Repository manifest missing. Run forge manifest discover, review and save the proposal first.");
    if (options.action === "analyze") {
      const snapshot = await analyzeRepository(root, loaded.manifest, { write: options.write, cacheRoot: options.cacheRoot });
      const ok = snapshot.coverage.errors === 0;
      return { exitCode: ok ? 0 : 1, ok, root, wroteArtifacts: options.write, snapshotId: snapshot.snapshotId, coverage: snapshot.coverage, snapshot };
    }
    const snapshot = readRepositorySnapshot(root, { cacheRoot: options.cacheRoot });
    if (!snapshot) throw new Error("Repository snapshot missing; run forge repository analyze --write first");
    const result = repositoryContext(root, snapshot, options.query ?? "overview", {
      snapshotId: options.snapshotId, limit: options.limit, maxChars: options.maxChars, cursor: options.cursor, manifest: loaded.manifest,
    });
    return { ...result, exitCode: result.ok ? 0 : 1 };
  } catch (error) { return { exitCode: 1, ok: false, diagnostics: [{ severity: "error", code: "FORGE_REPOSITORY", message: (error instanceof Error ? error.message : "Repository operation failed").slice(0, 512) }] }; }
}
