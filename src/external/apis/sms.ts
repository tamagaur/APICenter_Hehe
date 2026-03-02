// =============================================================================
// src/external/apis/sms.ts — SMS Service API configuration
// =============================================================================
// Defines the external SMS API. Provides:
//  - Send single and bulk SMS messages
//  - Delivery status tracking
//  - OTP (One-Time Password) verification
//
// The API Center holds the SMS API key; tribes only specify the recipient
// and message content.
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const smsApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_SMS_URL || 'https://api.sms-provider.com',
  authType: 'api-key',
  headerName: 'X-API-Key',
  tokenEnvKey: 'EXT_SMS_API_KEY',
  description: 'SMS services: send messages, delivery tracking, OTP verification',
};
