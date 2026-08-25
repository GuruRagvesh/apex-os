// Workforce Leave Applications — HTTP API surface.
//
// Reached only as '@apex/workforce-leave/api'. Declared as an exact public
// entry in architecture-boundaries.json: any deeper path into this folder is
// private and rejected.
//
// Deliberately separate from the component root barrel so consumers that want
// only a screen never load the authenticated client.

export { leaveApi, compOffApi } from './leave-api';
export type { CompOffCredit } from './leave-api';
