// Core Users — profiles component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the two profile surfaces: the signed-in user's own profile and the
// per-employee profile record. The admin-facing user directory belongs to
// core/users/administration and the approvals queue to core/users/change-requests.
// The users BACKEND (controller, service, module) remains in backend/src;
// backend slices are blocked until the Render deployment root moves.
//
// See ./docs/README.md for the legacy dependencies this component carries.

export * from './frontend';
