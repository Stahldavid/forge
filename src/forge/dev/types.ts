import type { DevRoute } from "../compiler/types/dev-manifest.ts";
import type { DbAdapter } from "../runtime/db/adapter.ts";

export type DevDbMode = "pglite" | "postgres" | "none";

export interface DevServerOptions {
  workspaceRoot: string;
  host: string;
  port: number;
  mock: boolean;
  json: boolean;
  db: DevDbMode;
  databaseUrl?: string;
  worker?: boolean;
  telemetry?: string[];
}

export interface DevServerDbState {
  kind: DevDbMode;
  connected: boolean;
}

export interface DevServerState {
  adapter: DbAdapter | null;
  db: DevServerDbState;
  outboxWorker?: {
    stop: () => void;
    isRunning: () => boolean;
  } | null;
}

export interface DevServerHandle {
  host: string;
  port: number;
  url: string;
  routes: DevRoute[];
  state: DevServerState;
  outboxWorker?: DevServerState["outboxWorker"];
  stop: () => void;
}

export interface DevWatchHandle {
  stop: () => void;
}
