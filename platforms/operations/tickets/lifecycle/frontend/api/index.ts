// Operations Tickets Lifecycle — HTTP API surface.
//
// Reached only as '@apex/operations-tickets-lifecycle/api'. Declared as an exact
// public entry in architecture-boundaries.json: any deeper path into this folder
// is private and rejected.
//
// Deliberately separate from the component root barrel so presentation-only
// consumers never load the authenticated client.

export { ticketsApi } from './tickets-api';
