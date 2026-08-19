// System Audit — component public entry point.
//
// This and the exact subpath '@apex/system-audit/api' are the ONLY paths other
// components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the read-only activity log. It renders events emitted by every other
// platform and owns no producer: this component owns the cross-domain event READ
// adapter only, published as the exact subpath '@apex/system-audit/api' rather
// than through this barrel. Every emitting domain keeps its own events, and the
// events BACKEND remains in backend/src.

export * from './frontend';
