// System Audit — HTTP API surface.
//
// Reached only as '@apex/system-audit/api'. Declared as an exact public entry
// in architecture-boundaries.json: any deeper path into this folder is private
// and rejected.
//
// Deliberately separate from the component root barrel.

export { eventsApi } from './events-api';
