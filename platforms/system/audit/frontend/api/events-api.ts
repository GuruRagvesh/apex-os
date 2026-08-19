// System Audit — operational event READ adapter.
//
// Moved verbatim from frontend/lib/api.ts. The method name, argument, endpoint,
// verb, params and unwrap are unchanged: this is a transport relocation, not a
// refactor.
//
// READ MODEL, NOT PRODUCER OWNERSHIP
// ----------------------------------
// GET /events is a single cross-domain aggregate read. Its backend controller
// has no service of its own: it queries the OperationalEvent table, applies
// per-request scoping through AccessPolicyService, and enriches rows at read
// time. It IS the read model.
//
// System Audit therefore owns THIS ADAPTER ONLY. Event PRODUCTION stays with
// the domains that emit it — tickets, projects, workday, leave, auth, settings,
// users, comments and sales all write through EventLoggerService and keep
// ownership of the events they emit. Nothing here may emit an event, and owning
// the read adapter confers no claim over any producer.
//
// Published as '@apex/system-audit/api', never through the component root
// barrel, so a consumer that wants the activity feed never loads the
// authenticated client for anything else.

import { api, unwrap as r } from '@apex/shared-auth';

export const eventsApi = {
  getAll: (params?: any) => r(api.get('/events', { params })),
};
