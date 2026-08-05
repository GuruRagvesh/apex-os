// Sales CRM Leads — component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/**, ./shared/** or any internal file across a
// component boundary is a boundary violation — see
// docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Phase 1A migrated the frontend slice only. The backend (controller, service,
// access policy, Nest module) deliberately remains in backend/src — see
// ./docs/README.md for why, and for the legacy dependencies this component
// still carries.

export * from './frontend';
export * from './shared';
