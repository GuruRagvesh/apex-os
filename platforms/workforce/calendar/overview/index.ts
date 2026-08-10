// Workforce Calendar — overview component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Per D11 calendar is its own cross-workforce module, not a leave sub-component:
// the screen aggregates approved leave AND scheduled tickets. It consumes those
// as data, and owns neither.

export * from './frontend';
