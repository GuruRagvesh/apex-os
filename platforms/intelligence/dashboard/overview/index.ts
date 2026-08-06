// Intelligence Dashboard — overview component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// The dashboard BACKEND (dashboard.controller, dashboard.service, home.controller)
// remains in backend/src — the Render deployment root has not moved yet.
// See ./docs/README.md for the legacy dependencies this component carries.

export * from './frontend';
