// Core Users Administration — user HTTP API.
//
// Moved verbatim from frontend/lib/api.ts. Every method name, argument,
// endpoint, verb, payload, unwrap and return value is unchanged: this is a
// transport relocation, not a refactor.
//
// WHY ADMINISTRATION OWNS IT
// --------------------------
// All three core/users components agree in their own docs that administration
// owns /users, /users/[id] and "the user directory"; profiles explicitly
// disclaims it and change-requests is scoped to the approvals queue. 13 of
// these 25 methods are administration operations, including every destructive
// one — permanentDelete, archiveAfterBackup, deactivate, resetPassword and
// adminCorrectEmail.
//
// getDirectory (GET /users/directory) joined on 2026-08-17, using the exact
// transport line teamApi had been issuing. teamApi.getDirectory() still
// exists in frontend/lib/api.ts but now delegates here, so the endpoint has
// exactly one implementation.
//
// Published as '@apex/core-users/api', never through the component root
// barrel: that barrel exports screens, and routing an HTTP module through it
// would drag the authenticated client into every consumer that wants a screen.
//
// TRANSPORT EXCEPTIONS CARRIED OVER, NOT INTRODUCED
// -------------------------------------------------
// downloadBackup, uploadPhoto and uploadDocument bypass the JSON axios
// instance for binary/multipart bodies, reading apex_token from localStorage
// and building their own Authorization header. That predates this move and is
// preserved byte-for-byte, exactly as the ticket API carries the same pattern.
// It is NOT the pattern to copy for new code.

import { api, unwrap as r, API_BASE_URL as API_URL } from '@apex/shared-auth';

export const usersApi = {
  getAll: (params?: any) => r(api.get('/users', { params })),
  getDirectory: () => r(api.get('/users/directory')),
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
