// Sales CRM Shared — component public entry point.
//
// This is the ONLY path other components, platforms or apps may import from.
// Reaching into ./frontend/**, ./shared/** or any internal file across a
// component boundary is a boundary violation — see
// docs/architecture/PUBLIC_API_CONVENTIONS.md.
//
// Consumed today by the migrated Leads slice and by the Sales CRM feature
// screens still living under frontend/components/sales-crm/. Those screens
// import this entry point rather than the moved files directly, which is why
// there is exactly one implementation of each shared concern.
//
// See ./docs/README.md for ownership, the temporary legacy dependency this
// component carries, and the conditions for removing it.

export * from './frontend';
export * from './shared';
