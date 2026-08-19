// Workforce Teams Team-Management — teams HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, query param, payload, unwrap and return value is unchanged:
// this is a transport relocation, not a refactor.
//
// WHY THIS COMPONENT OWNS IT
// --------------------------
// Ownership here is unusually clear-cut. This component's two screens use
// ALL EIGHT methods between them -- TeamsScreen covers getAll, create, update
// and remove; TeamDetailScreen covers getOne, update, addMember, updateMember
// and removeMember. The only other consumer in the repository,
// DepartmentDetailScreen, calls getAll() once to populate a team list.
// Team administration is the authority; the rest is a cross-component read
// through a public boundary.
//
// Frontend and backend agree on the owner. The migration map assigns
// teams.controller.ts and teams.service.ts to this component's backend/,
// even though the backend file currently sits under operations/team/ -- that
// is a path-naming legacy, not a domain disagreement. One @Controller('teams')
// exposes exactly these eight endpoints through one TeamsService.
//
// Published as '@apex/workforce-teams/api', never through the component root
// barrel: that barrel exports the screens, and routing an HTTP module through
// it would drag the authenticated client into every consumer that only wants
// presentation.

import { api, unwrap as r } from '@apex/shared-auth';

export const teamsApi = {
  getAll: (departmentId?: string) => r(api.get('/teams', { params: departmentId ? { departmentId } : undefined })),
  getOne: (id: string) => r(api.get(`/teams/${id}`)),
  create: (data: { name: string; departmentId: string; teamLeadId?: string }) => r(api.post('/teams', data)),
  update: (id: string, data: { name?: string; teamLeadId?: string | null }) => r(api.patch(`/teams/${id}`, data)),
  remove: (id: string) => r(api.delete(`/teams/${id}`)),
  addMember: (id: string, data: { userId: string; role?: string }) => r(api.post(`/teams/${id}/members`, data)),
  updateMember: (id: string, userId: string, data: { role: string }) =>
    r(api.patch(`/teams/${id}/members/${userId}`, data)),
  removeMember: (id: string, userId: string) => r(api.delete(`/teams/${id}/members/${userId}`)),
};
