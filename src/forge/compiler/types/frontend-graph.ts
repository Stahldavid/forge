import type { Diagnostic } from "./diagnostic.ts";

export interface FrontendRouteInfo {
  path: string;
  file: string;
  components: string[];
  usesCommands: string[];
  usesQueries: string[];
  usesLiveQueries: string[];
  rawForgeFetches: string[];
}

export interface FrontendComponentInfo {
  name: string;
  file: string;
  usesCommands: string[];
  usesQueries: string[];
  usesLiveQueries: string[];
  rawForgeFetches: string[];
}

export interface FrontendProviderInfo {
  name: string;
  file: string;
  apiUrlEnv?: string;
  devAuth: boolean;
}

export interface FrontendWebManifest {
  present: boolean;
  framework: "next" | "vite" | "static" | "unknown" | "none";
  root?: string;
  packageManager?: "bun" | "npm" | "pnpm" | "yarn" | "unknown";
  scripts: {
    dev?: string;
    build?: string;
    typecheck?: string;
  };
  urls: {
    dev?: string;
    api: string;
  };
  env: {
    apiUrl: string;
  };
  bridge: {
    files: string[];
    valid: boolean;
  };
}

export interface FrontendClientBindingInfo {
  kind: "command" | "query" | "liveQuery" | "rawFetch";
  name: string;
  file: string;
  route?: string;
  component?: string;
}

export interface FrontendGraph {
  schemaVersion: "0.1.0";
  present: boolean;
  framework: "next" | "vite" | "static" | "unknown" | "none";
  root?: string;
  dev?: {
    command: string;
    url: string;
    apiUrlEnv: string;
    defaultApiUrl: string;
  };
  routes: FrontendRouteInfo[];
  components: FrontendComponentInfo[];
  providers: FrontendProviderInfo[];
  bridgeFiles: string[];
  webManifest: FrontendWebManifest;
  clientBindings: FrontendClientBindingInfo[];
  diagnostics: Diagnostic[];
}
