// =============================================================================
// src/external/apis/index.ts — External API registry aggregator
// =============================================================================
// Aggregates all external API configurations into a single map.
// To add a new external API:
//  1. Create a new file in this folder (e.g., weather.ts)
//  2. Define the ExternalApiConfig
//  3. Import and add it to EXTERNAL_APIS below
//  4. Add any required env vars to .env.example
// =============================================================================

import { ExternalApiConfigMap } from '../../types';
import { geolocationApi } from './geolocation';
import { geofencingApi } from './geofencing';
import { paymentApi } from './payment';
import { smsApi } from './sms';
import { emailApi } from './email';

/**
 * Master registry of all external APIs available through the API Center.
 * The key is the API name used in routes: /api/external/{apiName}/...
 */
export const EXTERNAL_APIS: ExternalApiConfigMap = {
  'geolocation': geolocationApi,
  'geofencing': geofencingApi,
  'payment-gateway': paymentApi,
  'sms-service': smsApi,
  'email-service': emailApi,
  // TODO: Add more external APIs here as needed
  // 'weather': weatherApi,
  // 'push-notifications': pushNotificationApi,
};
