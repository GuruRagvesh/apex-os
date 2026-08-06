// Workforce Leave — applications component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** or ./shared/** across a component boundary is a
// boundary violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// The Leave BACKEND (controller, service, balance service, access policy, the
// scheduler's setLeaveStatuses job) remains in backend/src — the Render
// deployment root has not moved yet. See ./docs/README.md for the legacy
// dependencies this component still carries, and for why the map's
// applications/approvals split was not applied to the frontend.

export * from './frontend';
export * from './shared';
