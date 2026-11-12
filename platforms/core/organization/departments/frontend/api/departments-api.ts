// Core Organization Departments — department HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// default, endpoint, verb, payload, unwrap and return value is unchanged:
// this is a transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// This component's own two screens use 8 of the 9 methods, including every
// mutation — create, patch, remove, addManager, removeManager — plus getOne
// and getManagers. Every other consumer in the repository calls only
// getAll(), to populate a department dropdown or filter. Department
// administration is the authority here; the rest is cross-component read
// through a public boundary.
//
// Published as '@apex/core-organization-departments/api', never through the
// component root barrel: that barrel exports the two screens, and routing an
// HTTP module through it would drag the authenticated client into every
// consumer that only wants a screen.
//
// NOTE: update() (PUT /departments/:id) has zero consumers at the time of the
// move — patch() is what the detail screen calls. It is preserved verbatim
// under R100 rather than dropped; retiring it is a separate decision.

import { api, unwrap as r } from '@apex/shared-auth';

export const departmentsApi = {
  /** Departments for lists and filters; narrowed to the admin's top-bar department when one is set. */
  getAll: () => r(api.get('/departments')),
  /** Every department, ignoring the top-bar department: for the switcher and edit forms. */
  getAllCompany: () => r(api.get('/departments', { params: { all: 'true' } })),
  getOne: (id: string) => r(api.get(`/departments/${id}`)),
  create: (data: any) => r(api.post('/departments', data)),
  update: (id: string, data: any) => r(api.put(`/departments/${id}`, data)),
  patch: (id: string, data: any) => r(api.patch(`/departments/${id}`, data)),
  remove: (id: string) => r(api.delete(`/departments/${id}`)),
  getManagers: (id: string) => r(api.get(`/departments/${id}/managers`)),
  addManager: (id: string, userId: string) => r(api.post(`/departments/${id}/managers`, { userId })),
  removeManager: (id: string, userId: string) => r(api.delete(`/departments/${id}/managers/${userId}`)),
};
