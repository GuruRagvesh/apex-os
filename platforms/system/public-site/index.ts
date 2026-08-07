// System Public Site — component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Per architecture decision D4 this component collects the unauthenticated
// marketing and legal surfaces. They are real screens with no platform
// affiliation; putting them in apps/web would leak page implementation into
// the composition shell.
//
// This component has NO backend and no legacy dependencies. See ./docs/README.md.

export * from './frontend';
