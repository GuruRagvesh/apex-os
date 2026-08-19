// Apex OS — application-wide API methods.
//
// The authenticated axios instance, its interceptors, the token-key migration
// and the 401 redirect moved to shared/auth in Phase 2C so that platform
// slices can make authenticated requests without importing this legacy module.
// This file still owns every application-wide API group below, unchanged.
//
// This file no longer re-exports the raw axios instance. That re-export existed
// so callers could reach the client through the legacy path; its last consumer,
// cold-start-banner, moved to apps/web and now imports `api` from
// '@apex/shared-auth' directly. Anything needing the raw instance must do the
// same — this module is a domain-API façade, not a transport surface.
//
// `api` is still imported below because every group here issues requests
// through it. It remains the same singleton; this file does not create one.

import { api, unwrap as r } from '@apex/shared-auth';
import { usersApi } from '@apex/core-users/api';

// Users — implementation now owned by the Core Users Administration component
// and re-exported here for the 16 legacy consumers that still import it from
// this file. Temporary compatibility, not authority: the component holds the
// implementation, and migrated consumers import '@apex/core-users/api'
// directly.
//
// Imported rather than re-exported straight through, because teamApi below
// delegates getDirectory to it and a bare `export ... from` creates no local
// binding. The exported surface is identical either way.
export { usersApi };

// Comments
export const commentsApi = {
  getAll: (ticketId: string) => r(api.get(`/tickets/${ticketId}/comments`)),
  create: (ticketId: string, content: string) => r(api.post(`/tickets/${ticketId}/comments`, { content })),
  update: (ticketId: string, id: string, content: string) => r(api.put(`/tickets/${ticketId}/comments/${id}`, { content })),
  remove: (ticketId: string, id: string) => r(api.delete(`/tickets/${ticketId}/comments/${id}`)),
};

// AI Assistant
export const aiApi = {
  suggestPriority: (title: string, description: string) =>
    r(api.post('/ai/suggest-priority', { title, description })),
  summarizeTickets: () =>
    r(api.post('/ai/summarize-tickets', {})),
  ticketSuggestions: (id: string) =>
    r(api.post(`/ai/ticket-suggestions/${id}`, {})),
  triggerDigest: () =>
    r(api.post('/ai/trigger-digest', {})),
};

// Team — legacy directory/request flow (notification-only, no durable model)
export const teamApi = {
  getDirectory: () => usersApi.getDirectory(),
  sendRequest: (targetUserId: string, reason?: string) =>
    r(api.post('/team/request', { targetUserId, reason })),
};

// Settings
export const settingsApi = {
  getCompany:          ()         => r(api.get('/settings/company')),
  updateCompany:       (data: any) => r(api.patch('/settings/company', data)),
  getLeavePolicy:      ()         => r(api.get('/settings/leave-policy')),
  updateLeavePolicy:   (data: any) => r(api.patch('/settings/leave-policy', data)),
  getSla:              ()         => r(api.get('/settings/sla')),
  updateSla:           (data: any) => r(api.patch('/settings/sla', data)),
  getSmtp:             ()         => r(api.get('/settings/smtp')),
  updateSmtp:          (data: any) => r(api.patch('/settings/smtp', data)),
  testEmail:           (to?: string) => r(api.post('/settings/email/test', { to })),
  getWorkdayPolicy:    ()         => r(api.get('/settings/workday-policy')),
  updateWorkdayPolicy: (data: any) => r(api.patch('/settings/workday-policy', data)),
};

// Task Types
export const taskTypesApi = {
  getByDepartment: (departmentId?: string) =>
    r(api.get(`/task-types${departmentId ? `?departmentId=${departmentId}` : ''}`)),
  getAll: () => r(api.get('/task-types/all')),
  create: (data: { name: string; departmentId?: string; isGlobal?: boolean }) =>
    r(api.post('/task-types', data)),
  createSubtype: (typeId: string, data: { name: string }) =>
    r(api.post(`/task-types/${typeId}/subtypes`, data)),
  updateType: (id: string, data: { name?: string; order?: number }) =>
    r(api.patch(`/task-types/${id}`, data)),
  updateSubtype: (id: string, subtypeId: string, data: { name?: string; order?: number }) =>
    r(api.patch(`/task-types/${id}/subtypes/${subtypeId}`, data)),
  deleteType: (id: string) => r(api.delete(`/task-types/${id}`)),
  deleteSubtype: (id: string, subtypeId: string) =>
    r(api.delete(`/task-types/${id}/subtypes/${subtypeId}`)),
};

// Workday
export const workdayApi = {
  startWork: () => r(api.post('/workday/start', {})),
  endWork: () => r(api.post('/workday/end', {})),
  startBreak: (data: { breakType: string; estimatedMinutes?: number }) =>
    r(api.post('/workday/break/start', data)),
  endBreak: () => r(api.post('/workday/break/end', {})),
  resumeWork: () => r(api.post('/workday/resume', {})),
  reportIdle: (idleDuration: number) =>
    r(api.post('/workday/idle', { idleDuration })),
  resumeAutoClosedWork: () => r(api.post('/workday/resume-auto-closed', {})),
  continueWorking: () => r(api.post('/workday/continue-working', {})),
  getToday: () => r(api.get('/workday/today')),
  getTeam: () => r(api.get('/workday/team')),
  getHistory: (userId: string) => r(api.get(`/workday/history/${userId}`)),
};

// Sales CRM — Leads: moved in Phase 2C to the Sales CRM shared component,
// which owns it. Import it from '@apex/sales-crm-shared'.
//
// Deliberately NOT re-exported here. A compatibility re-export would pull the
// whole Sales CRM shared barrel — its auth adapter (and therefore the Zustand
// store), the audit-log React store and the mock-data module — into all 57
// consumers of this file, including the login page. No runtime consumer of
// the old path remains, so the re-export would buy nothing.

// Notifications
export const notificationsApi = {
  getAll: (unread?: boolean) => r(api.get('/notifications', { params: { unread } })),
  getUnreadCount: () => r(api.get('/notifications/unread-count')),
  markRead: (id: string) => r(api.patch(`/notifications/${id}/read`)),
  markAllRead: () => r(api.patch('/notifications/mark-all-read')),
  remove: (id: string) => r(api.delete(`/notifications/${id}`)),
};
