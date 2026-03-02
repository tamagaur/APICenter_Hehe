// =============================================================================
// src/external/apis/payment.ts — Payment Gateway API configuration
// =============================================================================
// Defines the external Payment Gateway API. Provides:
//  - Process payments and refunds
//  - Manage subscriptions and invoices
//  - Payment status webhooks
//
// Tribes call this through the API Center — they never handle payment
// credentials directly, which simplifies PCI compliance.
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const paymentApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_PAYMENT_URL || 'https://api.payment-provider.com',
  authType: 'bearer',
  tokenEnvKey: 'EXT_PAYMENT_TOKEN',
  description: 'Payment gateway: process payments, refunds, subscriptions, and invoices',
};
