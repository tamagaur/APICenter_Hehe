// =============================================================================
// src/kafka/schemas/registry.schemas.ts — Service registry event schemas
// =============================================================================

import { z } from 'zod';

export const RegistryServiceRegisteredEventSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  exposes: z.array(z.string()),
  isUpdate: z.boolean().optional(),
  timestamp: z.string().optional(),
});
export type RegistryServiceRegisteredEvent = z.infer<typeof RegistryServiceRegisteredEventSchema>;

export const RegistryServiceDeregisteredEventSchema = z.object({
  serviceId: z.string(),
  timestamp: z.string().optional(),
});
export type RegistryServiceDeregisteredEvent = z.infer<typeof RegistryServiceDeregisteredEventSchema>;
