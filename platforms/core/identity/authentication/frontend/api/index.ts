// Core Identity Authentication — HTTP API surface.
//
// Reached only as '@apex/core-identity/api'. Declared as an exact public entry
// in architecture-boundaries.json: any deeper path into this folder is private
// and rejected.
//
// Separate from the component root barrel on purpose -- that barrel publishes
// useAuthStore, and state consumers must not be made to load the
// authenticated client.

export { authApi } from './auth-api';
