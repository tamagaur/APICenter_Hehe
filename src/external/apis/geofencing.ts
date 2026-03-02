// =============================================================================
// src/external/apis/geofencing.ts — Geofencing API configuration
// =============================================================================
// Defines the external Geofencing API that tribes can access through the
// API Center. This API provides:
//  - Create and manage geofences (circular, polygon)
//  - Detect when a device enters/exits a geofence
//  - Trip tracking and location-based triggers
//  - Geofence event webhooks
//
// The actual provider (Radar.io, HERE, etc.) is configured via env vars.
// Tribes never see the API key — the API Center injects it on their behalf.
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const geofencingApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_GEOFENCING_URL || 'https://api.radar.io/v1',
  authType: 'api-key',
  headerName: 'Authorization',
  tokenEnvKey: 'EXT_GEOFENCING_API_KEY',
  description: 'Geofencing services: create/manage geofences, entry/exit detection, trip tracking',
};
