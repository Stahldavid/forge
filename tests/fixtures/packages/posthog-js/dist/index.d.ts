/**
 * Browser PostHog client.
 */
export declare class PostHog {
  capture(event: string, properties?: Record<string, unknown>): void;
  identify(distinctId: string): void;
}

export declare function init(apiKey: string, options?: InitOptions): PostHog;

export interface InitOptions {
  api_host?: string;
}
