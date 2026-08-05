// shared/auth — public entry point.
//
// This is the ONLY path platforms, apps and legacy frontend code may import
// from. Reaching into ./frontend/** across a module boundary is a boundary
// violation, enforced by scripts/architecture/validate-boundaries.mjs.
//
// Phase 2C put the authenticated HTTP client here. The backend half of this
// module (JwtAuthGuard, RolesGuard, @Roles, @CurrentUser, UserPayload — see
// ./README.md) has NOT migrated yet.
//
// When it does, this file must STOP re-exporting ./frontend wholesale: a Nest
// guard importing '@apex/shared-auth' would otherwise pull axios and the
// browser-only token migration into the server bundle. Split it then into
// explicit frontend/ and backend/ entry points.

export * from './frontend';
