// System Audit — component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the read-only activity log. It renders events emitted by every other
// platform and owns none of them. The events BACKEND remains in backend/src.

export * from './frontend';
