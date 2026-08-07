// Core Identity — authentication component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope today is the authentication STATE boundary only. The store itself
// still lives at frontend/store/auth.store.ts and was not moved: relocating it
// would require rewriting 29 legacy consumers, and the repository has no
// frontend test covering login, logout, hydration or the 401 path.
//
// See ./docs/README.md for what this component does and does not own.

export * from './frontend';
