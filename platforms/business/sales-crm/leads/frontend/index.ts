// Sales CRM Leads — frontend surface.
//
// The screen is the only view intended for outside consumption; the individual
// components below it are internal to this component and are deliberately not
// re-exported. The calculation and adapter helpers are published because the
// screen's contract with the backend is expressed through them.

export { default as SalesCrmLeads } from './screens/SalesCrmLeads';

export { getLeadsStats, filterAndSearchLeads } from './api/lead-calculations';
export type { LeadsStatsData, LeadFilterState, LeadSortState } from './api/lead-calculations';

export {
  mapBackendLead,
  mapBackendActivity,
  mapBackendFollowUp,
  mapBackendRequirement,
  mapBackendDeal,
  buildCreatePayload,
} from './api/lead-adapter';
