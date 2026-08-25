// Workforce Leave Applications — leave HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, query param, unwrap and return value is unchanged:
// this is a transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// LeaveScreen, which lives in this component, is the heaviest consumer by a
// wide margin: it calls 7 of the 9 methods, including every mutation --
// create, approve, reject -- plus getAll, getBalance, getDuration and
// getStats. The remaining consumers read one thing each: CalendarScreen calls
// getAll, the two user screens call getBalance, and the HRMS workspace calls
// getStats and getAll. Leave administration is the authority here; everything
// else is a cross-component read through a public boundary.
//
// Published as '@apex/workforce-leave/api', never through the component root
// barrel: that barrel exports the screen and its approver component, and
// routing an HTTP module through it would drag the authenticated client into
// every consumer that only wants presentation.
//
// cancel() has no consumer at the time of the move. It is preserved verbatim
// under R100 rather than dropped; retiring it is a separate decision.

import { api, unwrap as r } from '@apex/shared-auth';

export const leaveApi = {
  getAll: (params?: any) => r(api.get('/leave', { params })),
  getOne: (id: string) => r(api.get(`/leave/${id}`)),
  create: (data: any) => r(api.post('/leave', data)),
  approve: (id: string) => r(api.patch(`/leave/${id}/approve`)),
  reject: (id: string) => r(api.patch(`/leave/${id}/reject`)),
  cancel: (id: string) => r(api.patch(`/leave/${id}/cancel`)),
  getStats: () => r(api.get('/leave/stats')),
  getBalance: (userId?: string) => r(api.get(userId ? `/leave/balance/${userId}` : '/leave/balance')),
  getDuration: (startDate: string, endDate: string, isHalfDay: boolean) =>
    r(api.get('/leave/duration', { params: { startDate, endDate, isHalfDay } })),
};
