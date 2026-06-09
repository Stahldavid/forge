/**
 * Stripe SDK client.
 * @param apiKey Secret API key from the Stripe dashboard.
 */
export default class Stripe {
  constructor(apiKey: string, config?: StripeConfig);
  customers: CustomersResource;
}

export interface StripeConfig {
  apiVersion?: string;
}

export interface CustomersResource {
  create(params: CustomerCreateParams): Promise<Customer>;
}

export interface CustomerCreateParams {
  email?: string;
}

export interface Customer {
  id: string;
}
