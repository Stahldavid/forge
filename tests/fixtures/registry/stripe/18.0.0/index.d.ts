export declare const Stripe: {
  new (apiKey: string, config?: StripeConfig): StripeClient;
};
export interface StripeClient {
  checkout: {
    sessions: {
      create(input: CheckoutSessionCreateParams): Promise<CheckoutSession>;
    };
  };
}
export interface StripeConfig {
  apiVersion?: string;
}
export interface CheckoutSessionCreateParams {
  mode: string;
}
export interface CheckoutSession {
  id: string;
}
