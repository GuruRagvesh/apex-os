'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsApi } from '@/lib/api';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { useAuthStore } from '@apex/core-identity';
import toast from 'react-hot-toast';
import { Plus, Users, Building2, MoreVertical, Trash2, Pencil, ChevronRight, ChevronDown, Crown } from 'lucide-react';
import Link from 'next/link';

const MANAGE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'];

export default function TeamsScreen() {
  const router = useRouter();
  const { user, hasHydrated } = useAuthStore();
  const qc = useQueryClient();

  const role = (user?.role as any)?.name ?? '';
  const canManage = MANAGE_ROLES.includes(role);

  const [deptFilter, setDeptFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', departmentId: '', teamLeadId: '' });
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', teamLeadId: '' });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const { data: teams, isLoading } = useQuery({
    queryKey: ['teams', deptFilter],
    queryFn: () => teamsApi.getAll(deptFilter || undefined) as Promise<any[]>,
    enabled: hasHydrated,
  });
  const teamList: any[] = Array.isArray(teams) ? teams : [];

  const { data: departments = [] } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
    enabled: hasHydrated,
  });
  const departmentList: any[] = Array.isArray(departments) ? departments : [];

  const leadPickerDeptId = form.departmentId || editTarget?.departmentId || '';
  const { data: deptUsersData } = useQuery({
    queryKey: ['users', { departmentId: leadPickerDeptId }],
    queryFn: () => usersApi.getAll({ departmentId: leadPickerDeptId, limit: 100 }) as Promise<any>,
    enabled: hasHydrated && !!leadPickerDeptId && (showNew || !!editTarget),
  });
  const deptUsers: any[] = deptUsersData?.users ?? (Array.isArray(deptUsersData) ? deptUsersData : []);

  const createMutation = useMutation({
    mutationFn: () =>
      teamsApi.create({
        name: form.name.trim(),
        departmentId: form.departmentId,
        teamLeadId: form.teamLeadId || undefined,
      }),
    onSuccess: () => {
      toast.success('Team created');
      qc.invalidateQueries({ queryKey: ['teams'] });
      setShowNew(false);
      setForm({ name: '', departmentId: '', teamLeadId: '' });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create team'),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      teamsApi.update(editTarget.id, {
        name: editForm.name.trim(),
        teamLeadId: editForm.teamLeadId || null,
      }),
    onSuccess: () => {
      toast.success('Team updated');
      qc.invalidateQueries({ queryKey: ['teams'] });
      setEditTarget(null);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update team'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teamsApi.remove(id),
    onSuccess: () => {
      toast.success('Team deleted');
      qc.invalidateQueries({ queryKey: ['teams'] });
      setDeleteTarget(null);
      setDeleteError('');
    },
    onError: (err: any) => setDeleteError(err?.message || 'This team cannot be deleted right now.'),
  });

  if (!hasHydrated || isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto" onClick={() => menuOpen && setMenuOpen(null)}>
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Teams</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {teamList.length} team{teamList.length === 1 ? '' : 's'} - real teams and membership.{' '}
            Looking for the employee directory or to request someone join your team? See{' '}
            <Link href="/team" className="underline" style={{ color: 'var(--accent)' }}>Team</Link>.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="apex-select appearance-none pl-3 pr-8 py-2"
            >
              <option value="">All Departments</option>
              {departmentList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
          {canManage && (
            <button onClick={() => setShowNew(true)} className="apex-btn apex-btn-primary">
              <Plus size={16} /> New Team
            </button>
          )}
        </div>
      </div>

      {/* Team cards */}
      {teamList.length === 0 ? (
        <div className="apex-card border-dashed p-10 text-center">
          <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No teams found</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {canManage ? 'Create a team to get started.' : 'You are not yet a member or lead of any team.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {teamList.map((t) => (
            <div
              key={t.id}
              className="apex-card-clickable p-5 relative"
              onClick={() => router.push(`/teams/${t.id}`)}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                    <Users size={18} style={{ color: 'var(--accent)' }} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{t.name}</h3>
                    <p className="text-xs flex items-center gap-1 mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>
                      <Building2 size={11} /> {t.department?.name ?? '-'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                  {canManage && (
                    <div className="relative">
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === t.id ? null : t.id); }}
                        className="p-1 rounded-md transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <MoreVertical size={15} style={{ color: 'var(--text-tertiary)' }} />
                      </button>
                      {menuOpen === t.id && (
                        <div
                          className="absolute top-8 right-0 rounded-lg shadow-lg z-10 min-w-[140px] p-1"
                          style={{ backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border-primary)', boxShadow: 'var(--shadow-lg)' }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => { setEditForm({ name: t.name, teamLeadId: t.teamLeadId ?? '' }); setEditTarget(t); setMenuOpen(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors"
                            style={{ color: 'var(--text-primary)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <Pencil size={14} /> Edit
                          </button>
                          <button
                            onClick={() => { setDeleteTarget({ id: t.id, name: t.name }); setDeleteError(''); setMenuOpen(null); }}
                            className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors"
                            style={{ color: 'var(--color-danger)' }}
                            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)')}
                            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          >
                            <Trash2 size={14} /> Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {t.teamLead ? (
                <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <Crown size={12} style={{ color: 'var(--text-tertiary)' }} />
                  <span>Lead: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{t.teamLead.name}</span></span>
                </div>
              ) : (
                <p className="text-xs italic mb-3" style={{ color: 'var(--text-tertiary)' }}>No team lead assigned</p>
              )}

              <div className="rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                <div className="flex items-center justify-center mb-1">
                  <Users size={13} style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t.memberCount ?? 0}</p>
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Members</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Team Modal */}
      {showNew && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>New Team</h3>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Name *</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="apex-input"
                  placeholder="e.g., Frontend Squad"
                  autoFocus
                />
              </div>
              <div>
                <label className="apex-label">Department *</label>
                <select
                  value={form.departmentId}
                  onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value, teamLeadId: '' }))}
                  className="apex-select"
                >
                  <option value="">Select a department</option>
                  {departmentList.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="apex-label">Team Lead (optional)</label>
                <select
                  value={form.teamLeadId}
                  onChange={(e) => setForm((f) => ({ ...f, teamLeadId: e.target.value }))}
                  className="apex-select"
                  disabled={!form.departmentId}
                >
                  <option value="">No team lead</option>
                  {deptUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
                </select>
                {!form.departmentId && (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Select a department first</p>
                )}
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name.trim() && form.departmentId && createMutation.mutate()}
                disabled={createMutation.isPending || !form.name.trim() || !form.departmentId}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => { setShowNew(false); setForm({ name: '', departmentId: '', teamLeadId: '' }); }}
                className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Team Modal */}
      {editTarget && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <h3 className="font-bold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>Edit Team</h3>
            <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
              Department: <span className="font-medium">{editTarget.department?.name}</span> (cannot be changed here)
            </p>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Name *</label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                  className="apex-input"
                  autoFocus
                />
              </div>
              <div>
                <label className="apex-label">Team Lead</label>
                <select
                  value={editForm.teamLeadId}
                  onChange={(e) => setEditForm((f) => ({ ...f, teamLeadId: e.target.value }))}
                  className="apex-select"
                >
                  <option value="">No team lead</option>
                  {deptUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => editForm.name.trim() && updateMutation.mutate()}
                disabled={updateMutation.isPending || !editForm.name.trim()}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </button>
              <button onClick={() => setEditTarget(null)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-danger-bg)' }}>
                <Trash2 size={18} style={{ color: 'var(--color-danger)' }} />
              </div>
              <div>
                <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Delete Team</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm mb-3 rounded-lg p-3" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
              Delete <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{deleteTarget.name}</span>?
            </p>
            {deleteError && (
              <p className="text-sm mb-3 rounded-lg p-3 font-medium" style={{ color: 'var(--color-danger)', backgroundColor: 'var(--color-danger-bg)' }}>
                {deleteError}
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="apex-btn apex-btn-danger flex-1 justify-center py-2.5 disabled:opacity-50">
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
              <button onClick={() => { setDeleteTarget(null); setDeleteError(''); }} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
