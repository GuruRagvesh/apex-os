// Apex OS — application-wide API methods.
//
// The authenticated axios instance, its interceptors, the token-key migration
// and the 401 redirect moved to shared/auth in Phase 2C so that platform
// slices can make authenticated requests without importing this legacy module.
// This file still owns every application-wide API group below, unchanged.
//
// `api` is re-exported because callers import the raw instance from here
// (e.g. components/ui/cold-start-banner.tsx). It is the same singleton — this
// file does not create one.

import { api, unwrap as r, API_BASE_URL as API_URL } from '@apex/shared-auth';

export { api };

// Auth
export const authApi = {
  login: (email: string, password: string) => r(api.post('/auth/login', { email, password })),
  me: () => r(api.get('/auth/me')),
  changePassword: (currentPassword: string, newPassword: string) =>
    r(api.patch('/auth/change-password', { currentPassword, newPassword })),
  forgotPassword: (email: string) => r(api.post('/auth/forgot-password', { email })),
  resetPassword: (email: string, otp: string, newPassword: string) =>
    r(api.post('/auth/reset-password', { email, otp, newPassword })),
};

// Users
export const usersApi = {
  getAll: (params?: any) => r(api.get('/users', { params })),
  getMe: () => r(api.get('/users/me')),
  getMyTeam: () => r(api.get('/users/my-team')),
  updateMe: (data: any) => r(api.patch('/users/me', data)),
  getPreferences: () => r(api.get('/users/me/preferences')),
  updatePreferences: (data: any) => r(api.patch('/users/me/preferences', data)),
  getOne: (id: string) => r(api.get(`/users/${id}`)),
  create: (data: any) => r(api.post('/users', data)),
  update: (id: string, data: any) => r(api.put(`/users/${id}`, data)),
  resetPassword: (id: string, newPassword: string) => r(api.put(`/users/${id}/reset-password`, { newPassword })),
  deactivate: (id: string) => r(api.delete(`/users/${id}`)),
  downloadBackup: async (id: string, userName?: string) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : '';
    const res = await fetch(`${API_URL}/users/${id}/backup`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Backup failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Prefer filename from backend Content-Disposition; fall back to local construction
    const disposition = res.headers.get('Content-Disposition');
    const serverName = disposition?.match(/filename="([^"]+)"/)?.[1];
    const safe = (userName || id).replace(/[^a-z0-9]/gi, '_').toLowerCase();
    a.download = serverName ?? `backup-${safe}-${new Date().toISOString().split('T')[0]}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },
  getStats: () => r(api.get('/users/stats')),
  uploadPhoto: async (file: File) => {
    const formData = new FormData();
    formData.append('photo', file);
    return r(api.post('/users/me/photo', formData, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  removePhoto: () => r(api.delete('/users/me/photo')),
  getProfile: (id: string) => r(api.get(`/users/${id}/profile`)),
  updateProfile: (id: string, data: any) => r(api.patch(`/users/${id}/profile`, data)),
  adminCorrectEmail: (id: string, email: string, reason: string) =>
    r(api.patch(`/users/${id}/admin-correction`, { email, reason })),
  uploadDocument: async (id: string, file: File, documentType: string) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentType', documentType);
    return r(api.post(`/users/${id}/documents`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  getDocuments: (id: string) => r(api.get(`/users/${id}/documents`)),
  deleteDocument: (userId: string, docId: string) => r(api.delete(`/users/${userId}/documents/${docId}`)),
  verifyDocument: (userId: string, docId: string, status: string, rejectionReason?: string) =>
    r(api.patch(`/users/${userId}/documents/${docId}/verify`, { status, rejectionReason })),
  permanentDelete: (id: string) => r(api.delete(`/users/${id}/permanent`)),
  archiveAfterBackup: (id: string, data: { confirmBackupDownloaded: true }) =>
    r(api.post(`/users/${id}/archive-after-backup`, data)),
};

// Change Requests
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

// Roles
export const rolesApi = {
  getAll: () => r(api.get('/roles')),
  create: (data: any) => r(api.post('/roles', data)),
  update: (id: string, data: any) => r(api.put(`/roles/${id}`, data)),
  remove: (id: string) => r(api.delete(`/roles/${id}`)),
};

// Departments
export const departmentsApi = {
  getAll: () => r(api.get('/departments')),
  getOne: (id: string) => r(api.get(`/departments/${id}`)),
  create: (data: any) => r(api.post('/departments', data)),
  update: (id: string, data: any) => r(api.put(`/departments/${id}`, data)),
  patch: (id: string, data: any) => r(api.patch(`/departments/${id}`, data)),
  remove: (id: string) => r(api.delete(`/departments/${id}`)),
  getManagers: (id: string) => r(api.get(`/departments/${id}/managers`)),
  addManager: (id: string, userId: string) => r(api.post(`/departments/${id}/managers`, { userId })),
  removeManager: (id: string, userId: string) => r(api.delete(`/departments/${id}/managers/${userId}`)),
};

// Projects
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

// Tickets — implementation now owned by the Operations Tickets Lifecycle
// component and re-exported here for the legacy consumers that still import it
// from this file. Temporary compatibility, not authority: the component holds
// the implementation, and migrated consumers import
// '@apex/operations-tickets-lifecycle/api' directly.
export { ticketsApi } from '@apex/operations-tickets-lifecycle/api';

// Comments
export const commentsApi = {
  getAll: (ticketId: string) => r(api.get(`/tickets/${ticketId}/comments`)),
  create: (ticketId: string, content: string) => r(api.post(`/tickets/${ticketId}/comments`, { content })),
  update: (ticketId: string, id: string, content: string) => r(api.put(`/tickets/${ticketId}/comments/${id}`, { content })),
  remove: (ticketId: string, id: string) => r(api.delete(`/tickets/${ticketId}/comments/${id}`)),
};

// Dashboard
export const dashboardApi = {
  getOverview: () => r(api.get('/dashboard/overview')),
  getTicketsByCategory: () => r(api.get('/dashboard/tickets-by-category')),
  getTicketsByDepartment: () => r(api.get('/dashboard/tickets-by-department')),
  getActivityFeed: (limit?: number, userId?: string) => r(api.get('/dashboard/activity-feed', { params: { limit, userId } })),
  getWorkload: () => r(api.get('/dashboard/workload')),
  getTicketTrend: (days?: number) => r(api.get('/dashboard/ticket-trend', { params: { days } })),
  getHomeSummary: () => r(api.get('/home/summary')),
};

// Analytics — ledger-based evaluation engine (FP-13.3)
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

// Events
export const eventsApi = {
  getAll: (params?: any) => r(api.get('/events', { params })),
};

// Leave
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
  getDirectory: () => r(api.get('/users/directory')),
  sendRequest: (targetUserId: string, reason?: string) =>
    r(api.post('/team/request', { targetUserId, reason })),
};

// Teams — real Team/TeamMember CRUD (D3). Distinct from the legacy teamApi above.
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
