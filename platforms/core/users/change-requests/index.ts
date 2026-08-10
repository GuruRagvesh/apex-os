// Core Users — change-requests component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the approvals queue for user change requests. The admin-facing user
// directory belongs to core/users/administration and the two profile surfaces
// to core/users/profiles. The change-requests BACKEND (controller, service)
// remains in backend/src; backend slices are blocked until the Render
// deployment root moves.
//
// See ./docs/README.md for the legacy dependency this component carries.

export * from './frontend';
