export namespace Sentry {
  export interface BrowserOptions {
    dsn?: string;
    tracesSampleRate?: number;
  }
  export interface NodeOptions {
    dsn?: string;
    tracesSampleRate?: number;
  }
  export function init(options?: BrowserOptions | NodeOptions): void;
  export function captureException(error: unknown): string;
  export function withScope(callback: (scope: { setExtra: (k: string, v: unknown) => void }) => void): void;
}
