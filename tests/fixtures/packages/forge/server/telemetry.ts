export interface TelemetryContext {
  traceId: string;
  requestId?: string;
  capture: (name: string, properties?: Record<string, unknown>) => Promise<void>;
  captureException: (
    error: unknown,
    context?: Record<string, unknown>,
  ) => Promise<void>;
  log: (
    level: string,
    message: string,
    fields?: Record<string, unknown>,
  ) => Promise<void>;
  span: (
    name: string,
    attributes?: Record<string, unknown>,
  ) => Promise<{ spanId: string; end: (attributes?: Record<string, unknown>) => Promise<void> }>;
  flush: (sink?: string) => Promise<void>;
}

export interface ForgeContext {
  db: Record<string, unknown>;
  emit: (eventType: string, payload: unknown) => Promise<void>;
  env: Record<string, string | undefined>;
  /** Injected at runtime by the Forge runner — stub in builder types only. */
  telemetry: TelemetryContext;
}
