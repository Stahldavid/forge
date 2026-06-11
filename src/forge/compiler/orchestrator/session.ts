import { buildAppGraph } from "../app-graph/build.ts";
import type { AppGraph } from "../types/app-graph.ts";
import { discover, type DiscoverOptions } from "./discover.ts";
import { loadManifest } from "./manifest.ts";
import type { DiscoverContext, OrchestratorManifest } from "./types.ts";

export interface CompileSession {
  workspaceRoot: string;
  discoverContext?: DiscoverContext;
  manifest?: OrchestratorManifest;
  appGraph?: AppGraph;
  appGraphPromise?: Promise<AppGraph>;
}

const sessions = new Map<string, CompileSession>();

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return workspaceRoot.replace(/\\/g, "/");
}

export function getCompileSession(workspaceRoot: string): CompileSession {
  const key = normalizeWorkspaceRoot(workspaceRoot);
  const existing = sessions.get(key);
  if (existing) {
    return existing;
  }
  const session: CompileSession = { workspaceRoot: key };
  sessions.set(key, session);
  return session;
}

export function resetCompileSessions(): void {
  sessions.clear();
}

export function discoverForSession(
  session: CompileSession,
  options?: Omit<DiscoverOptions, "workspaceRoot">,
): DiscoverContext {
  if (session.discoverContext) {
    return session.discoverContext;
  }

  const manifest = loadManifestForSession(session);
  const priorSourcesByPath = new Map(
    (manifest.priorAppGraph?.sources ?? []).map((source) => [source.path, source]),
  );
  const ctx = discover({
    workspaceRoot: session.workspaceRoot,
    ...options,
    priorSourceIndex: manifest.sourceFileIndex,
    priorSourcesByPath,
  });
  session.discoverContext = ctx;
  return ctx;
}

export function loadManifestForSession(
  session: CompileSession,
): OrchestratorManifest {
  if (session.manifest) {
    return session.manifest;
  }
  const ctx = session.discoverContext;
  const cacheDir =
    ctx?.cacheDir ?? `${session.workspaceRoot}/.forge/cache`;
  session.manifest = loadManifest(cacheDir);
  return session.manifest;
}

export async function buildAppGraphForSession(
  session: CompileSession,
): Promise<AppGraph> {
  if (session.appGraph) {
    return session.appGraph;
  }
  if (session.appGraphPromise) {
    return session.appGraphPromise;
  }

  session.appGraphPromise = (async () => {
    const ctx = discoverForSession(session);
    const manifest = loadManifestForSession(session);
    const appGraph = await buildAppGraph({
      workspaceRoot: ctx.workspaceRoot,
      sources: ctx.sources,
      prior: manifest.priorAppGraph,
      tsconfigPath: ctx.tsconfigPath ?? undefined,
      tsconfigHash: ctx.tsconfigHash,
    });
    session.appGraph = appGraph;
    return appGraph;
  })();

  return session.appGraphPromise;
}
