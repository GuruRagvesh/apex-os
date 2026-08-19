// Core Organization — roles component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Scope is the roles REGISTRY: role records, their names, their hierarchy
// level and their descriptions. Authorization ENFORCEMENT is a different
// concern and stays in shared/auth (roles.guard.ts, constants/roles.ts).
// Assigning a role to a user belongs to core/users. See ./docs/README.md.
//
// There are no screens: no roles administration UI exists. The HTTP surface
// is published as the exact subpath '@apex/core-organization-roles/api'
// rather than through this barrel, so a consumer wanting the registry never
// loads an authenticated client it does not use. That is why this entry
// intentionally exports nothing: everything real is behind /api.

export {};
