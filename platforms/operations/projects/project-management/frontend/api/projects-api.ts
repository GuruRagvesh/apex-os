// Operations Projects — project HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, unwrap and return value is unchanged: this is a
// transport relocation, not a refactor.
//
// Published as '@apex/operations-projects/api', never through the component
// root barrel — that barrel exports screens, and routing an HTTP module
// through it would drag the authenticated client into every consumer that
// only wants a screen.
//
// Four consumers sit outside this component: ticket creation, the command
// palette, core/users administration and core/users profiles. Cross-component
// consumption through a public boundary is exactly what that boundary is for;
// it does not make project data generic.

import { api, unwrap as r } from '@apex/shared-auth';

export const projectsApi = {
  getAll: (params?: any) => r(api.get('/projects', { params })),
  getOne: (id: string) => r(api.get(`/projects/${id}`)),
  create: (data: any) => r(api.post('/projects', data)),
  update: (id: string, data: any) => r(api.put(`/projects/${id}`, data)),
  addMember: (id: string, userId: string, role?: string) => r(api.post(`/projects/${id}/members`, { userId, role })),
  removeMember: (id: string, userId: string) => r(api.delete(`/projects/${id}/members/${userId}`)),
  remove: (id: string) => r(api.delete(`/projects/${id}`)),
  getStats: () => r(api.get('/projects/stats')),
};
