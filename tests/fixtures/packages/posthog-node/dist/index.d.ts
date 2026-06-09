/**
 * Server-side PostHog client.
 */
export declare class PostHog {
  capture(params: CaptureParams): void;
  shutdown(): Promise<void>;
}

export interface CaptureParams {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}

export declare function createPostHog(apiKey: string): PostHog;
