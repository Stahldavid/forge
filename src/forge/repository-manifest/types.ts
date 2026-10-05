export interface RepositoryManifest {
  forgeProtocol: "2.0";
  kind: "repository";
  components: Array<{ id: string; root: string; adapters: string[]; files?: string[] }>;
  exclude?: string[];
  checks?: Array<{ id: string; component: string; argv: string[] }>;
  scenario?: { id?: string; composeFiles?: string[]; profiles?: string[]; mode?: string };
  services?: string[];
}

export const REPOSITORY_ADAPTERS = ["typescript", "javascript", "vue", "nuxt", "java", "spring", "maven", "gradle", "docker"] as const;
