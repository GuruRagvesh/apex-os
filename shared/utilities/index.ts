// shared/utilities — public entry point.
//
// This is the ONLY path platforms, apps, shared modules and legacy frontend
// code may import from. Small, dependency-free helpers used across the whole
// system, extracted from frontend/lib/utils.ts without changing behaviour.
//
// The bar for living here: used by more than one platform, no feature-specific
// business rule, no platform dependency. Domain vocabulary such as
// PROJECT_STATUS_COLORS or LEAVE_STATUS_COLORS is NOT here — it has since moved
// into the components that own it, which is the same rule applied one step
// further. Ticket vocabulary still waits in frontend/lib/utils.ts because
// operations/tickets has not migrated.
//
// shared/utilities must never import platforms/**, backend/**, a feature
// store, a feature API adapter, or the legacy frontend/ root.

export { cn } from './class-names';
export { formatDate } from './date';
export { formatRelativeTime } from './date';
export { getInitials } from './text';
