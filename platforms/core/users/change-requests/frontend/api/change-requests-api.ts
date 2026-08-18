// Core Users Change Requests — change-request HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, unwrap and return value is unchanged: this is a
// transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// ApprovalsScreen lives here and owns the approvals queue -- it calls
// listPendingApprovals, approve and reject, which are the decision points of
// the whole workflow. ProfileScreen drives the requester half (create,
// listMyRequests, cancel, getHierarchySummary), and the dashboard and HRMS
// workspaces each read listPendingApprovals for a count. The approvals
// workflow is the authority; the rest are reads through a public boundary.
//
// The endpoints live under /users/... on the backend because change requests
// are a users-domain resource served by change-requests.controller.ts, which
// is mounted on @Controller('users'). That is why this is a Core Users
// component rather than a workflow platform of its own.
//
// Published as '@apex/core-users-change-requests/api', never through the
// component root barrel: that barrel exports the screen, and routing an HTTP
// module through it would drag the authenticated client into every consumer
// that only wants presentation.
//
// getOne() has no consumer at the time of the move. It is preserved verbatim
// under R100 rather than dropped; retiring it is a separate decision.

import { api, unwrap as r } from '@apex/shared-auth';

export const changeRequestsApi = {
  getHierarchySummary: (id: string) => r(api.get(`/users/${id}/hierarchy-summary`)),
  create: (id: string, requestType: string, changes: any[], reason?: string) =>
    r(api.post(`/users/${id}/change-requests`, { requestType, changes, reason })),
  listMyRequests: () => r(api.get('/users/me/change-requests')),
  listPendingApprovals: () => r(api.get('/users/change-requests/pending')),
  getOne: (requestId: string) => r(api.get(`/users/change-requests/${requestId}`)),
  approve: (requestId: string, note?: string) => r(api.patch(`/users/change-requests/${requestId}/approve`, { note })),
  reject: (requestId: string, reason: string) => r(api.patch(`/users/change-requests/${requestId}/reject`, { reason })),
  cancel: (requestId: string) => r(api.patch(`/users/change-requests/${requestId}/cancel`)),
};
