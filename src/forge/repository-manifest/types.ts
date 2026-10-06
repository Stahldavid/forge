export const REPOSITORY_CHECK_CATEGORIES = ["typecheck", "test", "lint", "build", "integration", "security", "other"] as const;
export const REPOSITORY_CHECK_COSTS = ["low", "medium", "high"] as const;

export interface RepositoryComponent {
  id: string;
  root: string;
  adapters: string[];
  files?: string[];
  /** Static declarations only. All paths are relative to this component's root. */
  analysis?: {
    aliases?: Record<string, string>;
    nuxt?: { rootDir?: string; srcDir?: string; components?: string[]; imports?: string[] };
  };
}

export interface RepositoryCheck {
  id: string;
  component: string;
  argv: string[];
  /** Repository-relative working directory; omitted means repository root. */
  cwd?: string;
  /** Component-relative paths/globs for relevance, never execution scope. */
  files?: string[];
  category?: typeof REPOSITORY_CHECK_CATEGORIES[number];
  cost?: typeof REPOSITORY_CHECK_COSTS[number];
  /** Symbolic capabilities such as node, java, docker or network; no env values. */
  requires?: string[];
}

export interface RepositoryHttpClient {
  id: string;
  component: string;
  files?: string[];
  /** URL path prefix only, without origin, credentials, query or fragment. */
  basePath?: string;
  apiComponent?: string;
}

export const REPOSITORY_RUNTIME_ARTIFACT_FORMATS = ["nuxt-components", "nuxt-imports", "spring-mappings", "spring-beans", "docker-inspect", "http-trace", "forge-runtime"] as const;
export type RepositoryRuntimeArtifactFormat = typeof REPOSITORY_RUNTIME_ARTIFACT_FORMATS[number];
export interface RepositoryRuntimeCommand { argv: string[]; cwd?: string; timeoutMs?: number }
export interface RepositoryRuntimeArtifact { path: string; format: RepositoryRuntimeArtifactFormat }
export interface RepositoryRuntimeObservation {
  id: string;
  component: string;
  commands: RepositoryRuntimeCommand[];
  artifacts: RepositoryRuntimeArtifact[];
}

export interface RepositoryManifest {
  forgeProtocol: "2.0";
  kind: "repository";
  components: RepositoryComponent[];
  exclude?: string[];
  checks?: RepositoryCheck[];
  httpClients?: RepositoryHttpClient[];
  scenario?: { id?: string; composeFiles?: string[]; profiles?: string[]; mode?: string };
  services?: string[];
  /** Explicit execution contract. Static analysis never runs these commands. */
  runtime?: { observations: RepositoryRuntimeObservation[] };
}

export const REPOSITORY_ADAPTERS = ["typescript", "javascript", "vue", "nuxt", "java", "spring", "maven", "gradle", "docker"] as const;
