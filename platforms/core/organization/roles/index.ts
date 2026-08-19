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
// The component is established ahead of its content, exactly as the migration
// map schedules it. There are no screens: no roles administration UI exists.
// The HTTP surface arrives next as '@apex/core-organization-roles/api', which
// is published as an exact subpath rather than through this barrel so that
// consumers wanting the registry never load an authenticated client they do
// not use.

export {};
