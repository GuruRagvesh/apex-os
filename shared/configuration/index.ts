// shared/configuration — public entry point.
//
// This is the ONLY path platforms, apps, shared modules and legacy frontend code
// may import from. Per this module's README the bar is "constants used across
// platforms" — never feature-specific constants, which belong to the feature
// that owns them.
//
// shared/configuration must import nothing.

export { PRIORITY_LABELS, PRIORITY_COLORS } from './priority';
