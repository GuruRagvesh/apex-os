// Sales CRM Shared — HTTP API surface.
//
// Published separately from the component's root barrel, and reached only as
// '@apex/sales-crm-shared/api'.
//
// WHY THIS IS NOT IN THE ROOT BARREL
// ----------------------------------
// salesCrmLeadsApi pulls in the authenticated client, and therefore axios.
// Most Sales CRM screens need only types, constants, permissions, mock data or
// styles from this component — re-exporting the API from the root barrel made
// all of them load axios and evaluate the authenticated-client module, adding
// ~23 kB of First Load JS to five routes that never call the Leads API.
//
// So the rule is: the root barrel stays free of HTTP infrastructure, and
// anything that needs the API asks for it explicitly through this subpath.
//
// The subpath is declared as an EXACT public entry in
// architecture-boundaries.json — '@apex/sales-crm-shared/api' resolves here and
// is public; any deeper path into this folder is private and rejected.

export { salesCrmLeadsApi } from './sales-crm-leads-api';
