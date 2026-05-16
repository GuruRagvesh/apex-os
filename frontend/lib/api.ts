import axios, { type AxiosRequestConfig } from 'axios';

// Strip any trailing /api from the env var so we never get a double /api
// Works whether NEXT_PUBLIC_API_URL ends with /api or not
const API_URL = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/?$/, '')}/api`
  : 'http://localhost:3001/api';

export const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('apex_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('apex_token');
      localStorage.removeItem('nexus_user');
      window.location.href = '/login';
    }
    return Promise.reject(error.response?.data || error);
  },
);

// Typed wrappers — axios interceptor returns response.data directly
const r = <T = any>(p: any): Promise<T> => p as unknown as Promise<T>;

// Auth
export const authApi = {
  login: (email: string, password: string) => r(api.post('/auth/login', { email, password })),
  me: () => r(api.get('/auth/me')),
  changePassword: (currentPassword: string, newPassword: string) =>
    r(api.patch('/auth/change-password', { currentPassword, newPassword })),
};

// Users
export const usersApi = {
  getAll: (params?: any) => r(api.get('/users', { params })),
  getMe: () => r(api.get('/users/me')),
  getMyTeam: () => r(api.get('/users/my-team')),
  updateMe: (data: any) => r(api.patch('/users/me', data)),
  updatePreferences: (data: any) => r(api.patch('/users/me/preferences', data)),
  getOne: (id: string) => r(api.get(`/users/${id}`)),
  create: (data: any) => r(api.post('/users', data)),
  update: (id: string, data: any) => r(api.put(`/users/${id}`, data)),
  resetPassword: (id: string, newPassword: string) => r(api.put(`/users/${id}/reset-password`, { newPassword })),
  deactivate: (id: string) => r(api.delete(`/users/${id}`)),
  getStats: () => r(api.get('/users/stats')),
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

// Tickets
export const ticketsApi = {
  getAll: (params?: any) => r(api.get('/tickets', { params })),
  getOne: (id: string) => r(api.get(`/tickets/${id}`)),
  create: (data: any) => r(api.post('/tickets', data)),
  update: (id: string, data: any) => r(api.put(`/tickets/${id}`, data)),
  updateStatus: (id: string, status: string) => r(api.patch(`/tickets/${id}/status`, { status })),
  assign: (id: string, assignedToId: string) => r(api.patch(`/tickets/${id}/assign`, { assignedToId })),
  approve: (id: string) => r(api.patch(`/tickets/${id}/approve`)),
  reject: (id: string, comment: string) => r(api.patch(`/tickets/${id}/reject`, { comment })),
  getHistory: (id: string) => r(api.get(`/tickets/${id}/history`)),
  uploadAttachment: (id: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return r(api.post(`/tickets/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  exportCsv: async (params?: any) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : '';
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/tickets/export${query}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tickets-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  remove: (id: string) => r(api.delete(`/tickets/${id}`)),
  getStats: () => r(api.get('/tickets/stats')),
  getKanban: (params?: any) => r(api.get('/tickets/kanban', { params })),
};

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
  getActivityFeed: (limit?: number) => r(api.get('/dashboard/activity-feed', { params: { limit } })),
  getWorkload: () => r(api.get('/dashboard/workload')),
  getTicketTrend: (days?: number) => r(api.get('/dashboard/ticket-trend', { params: { days } })),
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

// Team
export const teamApi = {
  getDirectory: () => r(api.get('/users/directory')),
  sendRequest: (targetUserId: string, reason?: string) =>
    r(api.post('/team/request', { targetUserId, reason })),
};

// Settings
export const settingsApi = {
  getCompany: () => r(api.get('/settings/company')),
  updateCompany: (data: any) => r(api.patch('/settings/company', data)),
};

// Notifications
export const notificationsApi = {
  getAll: (unread?: boolean) => r(api.get('/notifications', { params: { unread } })),
  getUnreadCount: () => r(api.get('/notifications/unread-count')),
  markRead: (id: string) => r(api.patch(`/notifications/${id}/read`)),
  markAllRead: () => r(api.patch('/notifications/mark-all-read')),
  remove: (id: string) => r(api.delete(`/notifications/${id}`)),
};
