// Core Users Administration — HTTP API surface.
//
// Reached only as '@apex/core-users/api'. Declared as an exact public entry in
// architecture-boundaries.json: any deeper path into this folder is private
// and rejected.
//
// Deliberately separate from the component root barrel so consumers that want
// only a screen never load the authenticated client.

export { usersApi } from './users-api';
