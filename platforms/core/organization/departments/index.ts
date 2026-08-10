// Core Organization — departments component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is department administration: the directory and the per-department
// record, including membership, team lead and Department Head assignment. The
// roles registry belongs to core/organization/roles and the hierarchy approval
// service to core/organization/hierarchy — neither has migrated. The
// departments BACKEND remains in backend/src; backend slices are blocked until
// the Render deployment root moves.
//
// See ./docs/README.md for the legacy dependencies this component carries.

export * from './frontend';
