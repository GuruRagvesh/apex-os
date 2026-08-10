// Intelligence Analytics — overview component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the single /analytics workspace and the two charts it renders. The
// executive dashboard belongs to intelligence/dashboard/overview and the
// reports redirect to intelligence/reports — different components. The
// analytics BACKEND remains in backend/src; backend slices are blocked until
// the Render deployment root moves.
//
// See ./docs/README.md for the legacy dependency this component carries.

export * from './frontend';
