// =============================================================================
// src/external/apis/geolocation.ts — Geolocation API configuration
// =============================================================================
// Defines the external Geolocation API that tribes can access through the
// API Center. This API provides:
//  - Forward geocoding (address → coordinates)
//  - Reverse geocoding (coordinates → address)
//  - Place search and autocomplete
//  - Distance matrix calculations
//
// The actual provider (Google Maps, Mapbox, etc.) is configured via env vars.
// Tribes never see the API key — the API Center injects it on their behalf.
// =============================================================================

import { ExternalApiConfig } from '../../types';

export const geolocationApi: ExternalApiConfig = {
  baseUrl: process.env.EXT_GEOLOCATION_URL || 'https://maps.googleapis.com/maps/api',
  authType: 'api-key',
  headerName: 'X-API-Key',
  tokenEnvKey: 'EXT_GEOLOCATION_API_KEY',
  description: 'Geolocation services: geocoding, reverse geocoding, place search, and distance calculations',
};
