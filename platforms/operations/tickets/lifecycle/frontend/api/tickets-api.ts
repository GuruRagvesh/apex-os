// Operations Tickets Lifecycle — ticket HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// default, endpoint, verb, query parameter, payload, unwrap and return value
// is unchanged: this is a transport relocation, not a refactor.
//
// Published only as '@apex/operations-tickets-lifecycle/api', never through the
// component root barrel. The barrel is presentation-only (ticket visibility and
// vocabulary); re-exporting this module from it would drag the authenticated
// client — and therefore axios — into every consumer that wants only a label or
// a status helper. That is the regression recorded for the Sales CRM API.
//
// TRANSPORT EXCEPTIONS CARRIED OVER, NOT INTRODUCED
// -------------------------------------------------
// Three methods bypass the JSON axios instance because they return binary
// bodies: fetchAttachmentBlob, exportCsv and downloadImportTemplate. They use
// raw fetch() and read apex_token from localStorage to build the Authorization
// header themselves. exportCsv additionally recomputes its own base URL from
// process.env.NEXT_PUBLIC_API_URL rather than using API_URL.
//
// All of that predates this move and is preserved byte-for-byte. It is NOT the
// pattern to copy: new API code rides the shared client and touches neither
// localStorage nor the base URL. Retiring these exceptions is a behaviour
// change and belongs to its own phase.

import { api, unwrap as r, API_BASE_URL as API_URL } from '@apex/shared-auth';

export const ticketsApi = {
  getAll: (params?: any) => r(api.get('/tickets', { params })),
  getOne: (id: string) => r(api.get(`/tickets/${id}`)),
  create: (data: any) => r(api.post('/tickets', data)),
  update: (id: string, data: any) => r(api.put(`/tickets/${id}`, data)),
  updateStatus: (id: string, status: string) => r(api.patch(`/tickets/${id}/status`, { status })),
  assign: (id: string, assignedToId: string) => r(api.patch(`/tickets/${id}/assign`, { assignedToId })),
  approve: (id: string, ratings?: any) => r(api.patch(`/tickets/${id}/approve`, ratings)),
  reject: (id: string, comment: string) => r(api.patch(`/tickets/${id}/reject`, { comment })),
  getPendingApprovals: () => r(api.get('/tickets/pending-approvals')),
  approveTicketCreation: (id: string) => r(api.post(`/tickets/${id}/approval`, { action: 'APPROVE' })),
  rejectTicketCreation: (id: string, reason: string) => r(api.post(`/tickets/${id}/approval`, { action: 'REJECT', reason })),
  getHistory: (id: string) => r(api.get(`/tickets/${id}/history`)),
  uploadAttachment: (id: string, file: File, isPoc = false) => {
    const form = new FormData();
    form.append('file', file);
    if (isPoc) form.append('isPoc', 'true');
    return r(api.post(`/tickets/${id}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  fetchAttachmentBlob: async (ticketId: string, attachmentId: string, mode: 'inline' | 'download' = 'inline') => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : '';
    const res = await fetch(
      `${API_URL}/tickets/${ticketId}/attachments/${attachmentId}/download?mode=${mode}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    );
    if (!res.ok) {
      const message = res.status === 403
        ? 'You do not have permission to view this attachment.'
        : 'Attachment could not be loaded.';
      throw new Error(message);
    }
    return res.blob();
  },
  deleteAttachment: (ticketId: string, attachmentId: string) => r(api.delete(`/tickets/${ticketId}/attachments/${attachmentId}`)),
  exportCsv: async (params?: any) => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : '';
    const query = params ? '?' + new URLSearchParams(params).toString() : '';
    const baseUrl = process.env.NEXT_PUBLIC_API_URL
      ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/api\/?$/, '')}/api`
      : 'http://localhost:3001/api';
    const res = await fetch(
      `${baseUrl}/tickets/export${query}`,
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
  getSlaRisk: () => r(api.get('/tickets/sla-risk')),
  // Cross-department recipients for QUERY/HELP routing — separate from the TASK
  // assignee flow (getAll() + client-side department filter), which is untouched.
  // _ts busts the cache: Express auto-generates an ETag for this JSON response, and
  // when the browser revalidates with a matching If-None-Match it gets back a bare
  // 304 with no body. Axios's default validateStatus only accepts 2xx, so a 304
  // is routed to the error interceptor instead of the success path — the caller's
  // .catch() then silently resolves to an empty list, which is exactly what left
  // the Target Department / Ask-Route-To dropdowns empty in production.
  getRoutingOptions: (type: 'QUERY' | 'HELP', targetDepartmentId: string) =>
    r(api.get('/tickets/routing-options', { params: { type, targetDepartmentId, _ts: Date.now() } })),
  // Selectable TARGET departments for QUERY/HELP — unscoped (every department in
  // the company), unlike departmentsApi.getAll() which is limited to the caller's
  // own/managed department(s) for every non-admin role. Same 304 cache-bust as
  // getRoutingOptions above — see that comment for why _ts is required here.
  getRoutingDepartments: (type: 'QUERY' | 'HELP') =>
    r(api.get('/tickets/routing-departments', { params: { type, _ts: Date.now() } })),
  getKanban: (params?: any) => r(api.get('/tickets/kanban', { params })),
  blockTicket: (id: string, reason: string) => r(api.post(`/tickets/${id}/block`, { reason })),
  unblockTicket: (id: string) => r(api.post(`/tickets/${id}/unblock`)),
  unassignPrimary: (id: string) => r(api.post(`/tickets/${id}/unassign`)),
  removeAssignee: (id: string, userId: string) => r(api.delete(`/tickets/${id}/assignees/${userId}`)),
  // Bulk create — all-or-nothing. On validation failure the rejected error carries
  // { message, errors: [{ row, error }] } so the caller can show row-level messages.
  createBulk: (tickets: any[]) => r(api.post('/tickets/bulk', { tickets })),
  // Upload an .xlsx and get a per-row preview back (creates nothing).
  previewImport: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return r(api.post('/tickets/import-preview', form, { headers: { 'Content-Type': 'multipart/form-data' } }));
  },
  // Download the .xlsx import template (binary; bypasses the JSON axios instance).
  downloadImportTemplate: async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('apex_token') : '';
    const res = await fetch(`${API_URL}/tickets/import-template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('Could not download the import template.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'apex-ticket-import-template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  },
};
