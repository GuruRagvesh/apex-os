// Sales CRM — Leads HTTP API.
//
// Moved here verbatim from frontend/lib/api.ts in Phase 2C. Every endpoint
// string, HTTP method, parameter name, query/body placement and return shape
// below is unchanged.
//
// It rides the application's single authenticated client from shared/auth, so
// the Bearer-token header, the 401 redirect and the response.data unwrapping
// are exactly the ones every other Apex OS request already uses.
//
// This file must NOT: call axios.create, register an interceptor, read a token
// or localStorage, import a store, or import frontend/lib/api.ts.
//
// Feature-flagged in the UI via NEXT_PUBLIC_SALES_CRM_LEADS_BACKEND_ENABLED —
// see ./api-connector.ts#isSalesLeadsBackendEnabled. The flag gates the call
// sites, not this module; nothing here reads it.

import { api, unwrap as r } from '@apex/shared-auth';

export const salesCrmLeadsApi = {
  getAll: (params?: any) => r(api.get('/sales-crm/leads', { params })),
  getOne: (id: string) => r(api.get(`/sales-crm/leads/${id}`)),
  create: (data: any) => r(api.post('/sales-crm/leads', data)),
  update: (id: string, data: any) => r(api.put(`/sales-crm/leads/${id}`, data)),
  reassignOwner: (id: string, ownerId: string) => r(api.patch(`/sales-crm/leads/${id}/owner`, { ownerId })),
  bulkUpdate: (data: { leadIds: string[]; ownerId?: string; leadStage?: string }) =>
    r(api.patch('/sales-crm/leads/bulk', data)),
  addActivity: (id: string, data: any) => r(api.post(`/sales-crm/leads/${id}/activities`, data)),
  addFollowup: (id: string, data: any) => r(api.post(`/sales-crm/leads/${id}/followups`, data)),
  addRequirement: (id: string, data: any) => r(api.post(`/sales-crm/leads/${id}/requirements`, data)),
  addDeal: (id: string, data: any) => r(api.post(`/sales-crm/leads/${id}/deals`, data)),
  remove: (id: string) => r(api.delete(`/sales-crm/leads/${id}`)),
};
