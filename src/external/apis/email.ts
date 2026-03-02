// =============================================================================
// src/external/apis/email.ts — Email Service API configuration
// =============================================================================
// Defines the external Email API. Provides:
//  - Send transactional and marketing emails
//  - Template-based email rendering
//  - Delivery and open/click tracking
//
// The API Center manages the email service token so tribes don't need
// individual email provider accounts.
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const emailApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_EMAIL_URL || 'https://api.email-provider.com',
  authType: 'bearer',
  tokenEnvKey: 'EXT_EMAIL_TOKEN',
  description: 'Email services: transactional emails, templates, delivery tracking',
};
