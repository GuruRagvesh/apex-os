// Intelligence Dashboard Overview — dashboard HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, query param, unwrap and return value is unchanged: this is
// a transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// DashboardScreen lives here and is the only consumer that reads the
// dashboard's own composite payloads -- getOverview and getHomeSummary --
// while TeamPressurePanel, also here, reads getWorkload. The three external
// consumers each take a single cross-cutting read: AnalyticsScreen charts
// four series, and the two user screens read getActivityFeed. The dashboard
// is the authority; the rest is read through a public boundary.
//
// getHomeSummary calls /home/summary rather than /dashboard/*. That is not a
// second domain: home.controller.ts sits in the same backend module
// (backend/src/modules/platform/dashboard/) and delegates to the same
// DashboardService. The URL prefix differs; the ownership does not.
//
// Published as '@apex/intelligence-dashboard/api', never through the
// component root barrel: that barrel exports the screen, and routing an HTTP
// module through it would drag the authenticated client into every consumer
// that only wants presentation.
//
// getTicketsByDepartment has no consumer at the time of the move. It is
// preserved verbatim under R100 rather than dropped; retiring it is a
// separate decision.

import { api, unwrap as r } from '@apex/shared-auth';

export const dashboardApi = {
  getOverview: () => r(api.get('/dashboard/overview')),
  getTicketsByCategory: () => r(api.get('/dashboard/tickets-by-category')),
  getTicketsByDepartment: () => r(api.get('/dashboard/tickets-by-department')),
  getActivityFeed: (limit?: number, userId?: string) => r(api.get('/dashboard/activity-feed', { params: { limit, userId } })),
  getWorkload: () => r(api.get('/dashboard/workload')),
  getTicketTrend: (days?: number) => r(api.get('/dashboard/ticket-trend', { params: { days } })),
  getHomeSummary: () => r(api.get('/home/summary')),
};
