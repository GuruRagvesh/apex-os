// Intelligence Analytics Overview — HTTP API surface.
//
// Reached only as '@apex/intelligence-analytics/api'. Declared as an exact
// public entry in architecture-boundaries.json: any deeper path into this
// folder is private and rejected.
//
// Deliberately separate from the component root barrel so consumers that want
// only a screen never load the authenticated client.

export { analyticsApi } from './analytics-api';
