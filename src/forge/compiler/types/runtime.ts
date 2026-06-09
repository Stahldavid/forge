export const RUNTIME_CONTEXTS = [
  "shared",
  "client",
  "server",
  "query",
  "liveQuery",
  "command",
  "action",
  "workflow",
  "endpoint",
  "edge",
  "test",
  "build",
] as const;

export type RuntimeContext = (typeof RUNTIME_CONTEXTS)[number];

export const DETERMINISTIC_CONTEXTS = [
  "command",
  "query",
  "liveQuery",
] as const satisfies readonly RuntimeContext[];

export type DeterministicContext = (typeof DETERMINISTIC_CONTEXTS)[number];

export type PackageManager = "bun" | "npm" | "pnpm" | "yarn";

export type ResolutionMode = "nodenext" | "bundler";

export type SandboxBackend = "none" | "child" | "docker";
