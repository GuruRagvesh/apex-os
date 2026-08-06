// Operations Projects — project-management component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/** across a component boundary is a boundary
// violation — see docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Compartmentalised in the Operations Projects frontend phase: the two screens
// moved here verbatim. The Projects BACKEND (controller, service, Nest module)
// deliberately remains in backend/src — the Render deployment root has not
// moved yet. See ./docs/README.md for the legacy dependencies this component
// still carries and why each one could not follow the screens.

export * from './frontend';
