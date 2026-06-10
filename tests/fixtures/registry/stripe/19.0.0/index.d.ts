export declare const Stripe: {
  new (apiKey: string, config: StripeConfigV2): StripeClient;
};
export interface StripeClient {
  checkout: {
    sessions: {
      create(input: CheckoutSessionCreateParamsV2): Promise<CheckoutSession>;
    };
  };
}
export interface StripeConfigV2 {
  apiVersion: string;
  timeoutMs?: number;
}
export interface CheckoutSessionCreateParamsV2 {
  mode: string;
  successUrl: string;
}
export interface CheckoutSession {
  id: string;
}
