import type { DevRoute } from "../compiler/types/dev-manifest.ts";

export interface DevServerOptions {
  workspaceRoot: string;
  host: string;
  port: number;
  mock: boolean;
  json: boolean;
}

export interface DevServerHandle {
  host: string;
  port: number;
  url: string;
  routes: DevRoute[];
  stop: () => void;
}

export interface DevWatchHandle {
  stop: () => void;
}
