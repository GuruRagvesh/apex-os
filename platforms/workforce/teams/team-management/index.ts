// Workforce Teams — team-management component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is team CRUD and membership — the plural `teams.*` feature. The
// singular `team.*` reporting-lines surface is a DIFFERENT component and has
// not migrated. The teams BACKEND remains in backend/src.

export * from './frontend';
