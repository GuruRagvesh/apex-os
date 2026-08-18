// Intelligence Analytics Overview — analytics HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// default, endpoint, verb, query param, unwrap and return value is unchanged:
// this is a transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// AnalyticsScreen lives here and calls all six methods -- command centre,
// employee, reviewer and manager metrics, SLA and rework. The only other
// consumer, UserProfileScreen, takes a single read (getReviewerMetrics) to
// show one person's reviewer figures. Analytics is unambiguously the
// authority; the other is a cross-component read through a public boundary.
//
// Published as '@apex/intelligence-analytics/api', never through the
// component root barrel: that barrel exports the screen, and routing an HTTP
// module through it would drag the authenticated client into every consumer
// that only wants presentation.
//
// getEmployeeMetrics and getReviewerMetrics keep their optional-id branch,
// which selects between '/analytics/employee/:id' and '/analytics/employee'.
// That is URL construction, not a policy decision, and the backend exposes
// both shapes via @Get('employee/:id?'). Preserved exactly.

import { api, unwrap as r } from '@apex/shared-auth';

export const analyticsApi = {
  getCommandCenter: (period: 'today' | 'week' | 'month' = 'today') =>
    r(api.get('/analytics/command-center', { params: { period } })),
  getEmployeeMetrics: (userId?: string) =>
    r(api.get(userId ? `/analytics/employee/${userId}` : '/analytics/employee')),
  getReviewerMetrics: (userId?: string) =>
    r(api.get(userId ? `/analytics/reviewer/${userId}` : '/analytics/reviewer')),
  getManagerMetrics: () =>
    r(api.get('/analytics/manager')),
  getSlaAnalytics: () =>
    r(api.get('/analytics/sla')),
  getReworkAnalytics: () =>
    r(api.get('/analytics/rework')),
};
