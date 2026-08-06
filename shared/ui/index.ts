// shared/ui — public entry point.
//
// This is the ONLY path platforms, apps and legacy frontend code may import
// from. Reaching into ./frontend/** across a module boundary is a boundary
// violation, enforced by scripts/architecture/validate-boundaries.mjs.
//
// shared/ui must never import platforms/**, backend/**, a feature store, a
// feature API adapter, or the legacy frontend/ root. Primitives that still
// need `cn` from frontend/lib/utils.ts (skeleton, multi-select, status-badge)
// deliberately did NOT move — see ./docs/README.md.
//
// Everything here is browser-only today. If a server-side primitive is ever
// added, split this into explicit frontend/ and backend/ entry points rather
// than widening this barrel.

export * from './frontend';
