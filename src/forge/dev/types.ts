import type { DevRoute } from "../compiler/types/dev-manifest.ts";
import type { DbAdapter } from "../runtime/db/adapter.ts";
import type { AmbientDeltaRecorder } from "../delta/recorder.ts";
import type { Diagnostic } from "../compiler/types/diagnostic.ts";

export type DevDbMode = "memory" | "pglite" | "postgres" | "none";

export interface DevServerOptions {
  workspaceRoot: string;
  host: string;
  port: number;
  mock: boolean;
  mockAi?: boolean;
  json: boolean;
  db: DevDbMode;
  databaseUrl?: string;
  worker?: boolean;
  telemetry?: string[];
  envFile?: string;
  mode?: "dev" | "serve";
  allowDevAuth?: boolean;
  webUrl?: string;
  deltaRecorder?: AmbientDeltaRecorder;
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
  reload: (reason?: string) => Promise<DevServerReloadResult>;
  stop: () => void;
}

export interface DevServerReloadResult {
  ok: boolean;
  reason: string;
  migrated: boolean;
  routes: number;
  runtimeEntries: number;
  worker: "running" | "stopped";
  diagnostics: Diagnostic[];
}

export interface DevWatchHandle {
  stop: () => void;
}
