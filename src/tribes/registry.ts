// =============================================================================
// src/tribes/registry.ts — Legacy tribe registry (backwards compatibility)
// =============================================================================
// This file now re-exports from the Dynamic Service Registry.
// It exists for backwards compatibility — any code that still imports
// `tribeRegistry` from this path will get the new ServiceRegistry.
//
// NEW CODE SHOULD IMPORT FROM: ../registry/serviceRegistry
// =============================================================================

export { serviceRegistry as tribeRegistry } from '../registry/serviceRegistry';
