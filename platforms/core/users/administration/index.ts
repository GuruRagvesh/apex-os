// Core Users — administration component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the admin-facing user directory and user detail screens. The
// self-service profile screens belong to core/users/profiles and the approvals
// queue to core/users/change-requests — neither has migrated. The users
// BACKEND (controller, service, module) remains in backend/src; backend slices
// are blocked until the Render deployment root moves.
//
// See ./docs/README.md for the legacy dependencies this component carries.

export * from './frontend';
