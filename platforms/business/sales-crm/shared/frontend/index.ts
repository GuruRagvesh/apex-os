// Sales CRM Shared — frontend surface.
//
// Browser-side adapters shared by every Sales CRM component: the auth adapter
// that maps an Apex identity onto a CRM role, the audit-log store, and the
// data-mode connector that decides whether a store reads mock data or a real
// endpoint.
//
// Stylesheets are deliberately NOT published here. The Sales CRM CSS modules
// remain in frontend/styles/sales-crm/ for now — see ../docs/README.md.

export { useAuth, mapApexRoleToCrmRole } from './api/auth-adapter';
export type { UseAuthResult } from './api/auth-adapter';

export { logAction, useAuditLogs } from './api/audit-log';

export {
  SALES_CRM_DATA_MODE,
  isMockMode,
  resolveDataSource,
  isSalesLeadsBackendEnabled,
} from './api/api-connector';
export type { SalesCrmDataMode } from './api/api-connector';

// The Leads HTTP API is deliberately NOT exported here. It lives behind the
// '@apex/sales-crm-shared/api' subpath so that consumers needing only types,
// constants, permissions, mock data or styles do not load axios or evaluate
// the authenticated-client module. See ./api/index.ts.
