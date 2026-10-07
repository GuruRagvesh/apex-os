'use client';

// Workforce Teams — teams managed inside their department (QC: Manage Teams
// removed; New Team lives in Departments and each department lists its teams).
//
// Moved from the retired TeamsScreen / TeamDetailScreen. The dialogs, fields,
// endpoints, validation and messages are the ones those screens used; only
// where they appear has changed. The server still decides who may do what
// (teams.controller: ADMIN, SUPER_ADMIN, MANAGER in scope).

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Users, Pencil, Trash2, Crown, ChevronDown, ChevronRight, UserMinus, UserPlus } from 'lucide-react';
import { teamsApi } from '../api';
import { usersApi } from '@apex/core-users/api';

/** Roles the teams API accepts for create, edit, delete and membership. */
export const TEAM_MANAGE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'];

function useDepartmentUsers(departmentId: string, enabled: boolean) {
  const { data } = useQuery({
    queryKey: ['users', { departmentId }],
    queryFn: () => usersApi.getAll({ departmentId, limit: 100 }) as Promise<any>,
    enabled: enabled && !!departmentId,
  });
  return (data?.users ?? (Array.isArray(data) ? data : [])) as any[];
}

// ── New Team (the Manage Teams pop-up, unchanged) ───────────────────────────

export function NewTeamDialog({
  departments,
  defaultDepartmentId = '',
  onClose,
}: {
  departments: any[];
  defaultDepartmentId?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: '', departmentId: defaultDepartmentId, teamLeadId: '' });
  const deptUsers = useDepartmentUsers(form.departmentId, true);

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
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create team'),
  });

  return (
    <div className="apex-backdrop flex items-center justify-center p-4">
      <div className="apex-modal w-full max-w-sm p-6 modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="New Team">
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
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
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
          <button onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit Team (name and lead, unchanged) ────────────────────────────────────

function EditTeamDialog({ team, departmentName, onClose }: { team: any; departmentName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: team.name ?? '', teamLeadId: team.teamLeadId ?? team.teamLead?.id ?? '' });
  const deptUsers = useDepartmentUsers(team.departmentId, true);

  const updateMutation = useMutation({
    mutationFn: () => teamsApi.update(team.id, { name: form.name.trim(), teamLeadId: form.teamLeadId || null }),
    onSuccess: () => {
      toast.success('Team updated');
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['team', team.id] });
      onClose();
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update team'),
  });

  return (
    <div className="apex-backdrop flex items-center justify-center p-4">
      <div className="apex-modal w-full max-w-sm p-6 modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Edit Team">
        <h3 className="font-bold text-lg mb-1" style={{ color: 'var(--text-primary)' }}>Edit Team</h3>
        <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
          Department: <span className="font-medium">{departmentName}</span> (cannot be changed here)
        </p>
        <div className="space-y-3">
          <div>
            <label className="apex-label">Name *</label>
            <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="apex-input" autoFocus />
          </div>
          <div>
            <label className="apex-label">Team Lead</label>
            <select value={form.teamLeadId} onChange={(e) => setForm((f) => ({ ...f, teamLeadId: e.target.value }))} className="apex-select">
              <option value="">No team lead</option>
              {deptUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => form.name.trim() && updateMutation.mutate()}
            disabled={updateMutation.isPending || !form.name.trim()}
            className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Delete Team (unchanged, server reason shown inline) ─────────────────────

function DeleteTeamDialog({ team, onClose }: { team: any; onClose: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState('');
  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.remove(team.id),
    onSuccess: () => {
      toast.success('Team deleted');
      qc.invalidateQueries({ queryKey: ['teams'] });
      onClose();
    },
    onError: (err: any) => setError(err?.message || 'This team cannot be deleted right now.'),
  });

  return (
    <div className="apex-backdrop flex items-center justify-center p-4">
      <div className="apex-modal w-full max-w-sm p-6 modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto" role="dialog" aria-modal="true" aria-label="Delete Team">
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
          Delete <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{team.name}</span>?
        </p>
        {error && (
          <p className="text-sm mb-3 rounded-lg p-3 font-medium" style={{ color: 'var(--color-danger)', backgroundColor: 'var(--color-danger-bg)' }}>
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending} className="apex-btn apex-btn-danger flex-1 justify-center py-2.5 disabled:opacity-50">
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </button>
          <button onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
        </div>
      </div>
    </div>
  );
}

// ── Members of one team (from the retired team page) ────────────────────────

function TeamMembers({ team, canManage }: { team: any; canManage: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: detail, isLoading, isError } = useQuery({
    queryKey: ['team', team.id],
    queryFn: () => teamsApi.getOne(team.id) as Promise<any>,
  });
  const deptUsers = useDepartmentUsers(team.departmentId, canManage && adding);
  const members: any[] = detail?.members ?? [];
  const memberIds = new Set(members.map((m: any) => m.userId));
  const nonMembers = deptUsers.filter((u: any) => !memberIds.has(u.id));

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team', team.id] });
    qc.invalidateQueries({ queryKey: ['teams'] }); // member counts
  };
  const addMutation = useMutation({
    mutationFn: () => teamsApi.addMember(team.id, { userId: selectedUserId }),
    onSuccess: () => { toast.success('Member added'); refresh(); setAdding(false); setSelectedUserId(''); },
    onError: (err: any) => toast.error(err?.message || 'Failed to add member'),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(team.id, userId),
    onSuccess: () => { toast.success('Member removed'); refresh(); },
    onError: (err: any) => toast.error(err?.message || 'Failed to remove member'),
  });

  if (isLoading) return <p className="px-5 py-3 text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading members…</p>;
  if (isError) return <p className="px-5 py-3 text-xs" role="alert" style={{ color: 'var(--color-danger)' }}>Could not load this team's members.</p>;

  return (
    <div className="px-5 pb-4 pt-1 space-y-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
      {members.length === 0 && (
        <p className="text-xs py-2" style={{ color: 'var(--text-tertiary)' }}>No members yet.</p>
      )}
      {members.map((m: any) => (
        <div key={m.id ?? m.userId} className="flex items-center gap-3 py-1.5">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
              {m.user?.name}
              {team.teamLeadId === m.userId && <Crown size={12} style={{ color: 'var(--color-warning)' }} aria-label="Team lead" />}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.user?.email}</p>
          </div>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{m.user?.role?.name}</span>
          {canManage && (
            <button
              onClick={() => { if (confirm(`Remove ${m.user?.name} from ${team.name}?`)) removeMutation.mutate(m.userId); }}
              disabled={removeMutation.isPending}
              className="p-1 rounded transition-colors text-slate-400 hover:text-red-500 disabled:opacity-50"
              title="Remove from team"
            >
              <UserMinus size={13} />
            </button>
          )}
        </div>
      ))}
      {canManage && (adding ? (
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <select value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="apex-select flex-1 min-w-[12rem]" aria-label="Member to add">
            <option value="">Select a department member</option>
            {nonMembers.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
          </select>
          <button onClick={() => selectedUserId && addMutation.mutate()} disabled={!selectedUserId || addMutation.isPending} className="apex-btn apex-btn-primary text-xs disabled:opacity-50">
            {addMutation.isPending ? 'Adding...' : 'Add'}
          </button>
          <button onClick={() => { setAdding(false); setSelectedUserId(''); }} className="apex-btn apex-btn-secondary text-xs">Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs font-medium inline-flex items-center gap-1 pt-1" style={{ color: 'var(--accent)' }}>
          <UserPlus size={12} /> Add member
        </button>
      ))}
    </div>
  );
}

// ── The Teams container on a department page ────────────────────────────────

export function DepartmentTeamsPanel({
  department,
  departments,
  canManage,
}: {
  /** The department being viewed ({ id, name }). */
  department: { id: string; name: string };
  /** For the New Team dialog's department select (pre-selected to this one). */
  departments: any[];
  canManage: boolean;
}) {
  const [showNew, setShowNew] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<any | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['teams', department.id],
    queryFn: () => teamsApi.getAll(department.id) as Promise<any[]>,
    enabled: !!department.id,
  });
  const teams: any[] = Array.isArray(data) ? data : [];

  return (
    <div className="apex-card overflow-hidden">
      <div className="px-5 py-4 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
          Teams
          <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>({teams.length})</span>
        </h2>
        {canManage && (
          <button onClick={() => setShowNew(true)} className="apex-btn apex-btn-primary text-xs">
            <Plus size={14} /> New Team
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="px-5 py-4 text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading teams…</p>
      ) : isError ? (
        <div className="px-5 py-4 text-sm flex items-center gap-3" role="alert" style={{ color: 'var(--color-danger)' }}>
          Could not load teams.
          <button onClick={() => refetch()} className="apex-btn apex-btn-secondary text-xs">Retry</button>
        </div>
      ) : teams.length === 0 ? (
        <div className="px-5 py-6 text-center">
          <Users size={20} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
          {/* Without team management rights the teams API lists only the
              teams you lead or belong to, so an empty list means exactly that. */}
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {canManage ? 'No teams in this department yet.' : 'You are not in any team in this department.'}
          </p>
        </div>
      ) : (
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {teams.map((t: any) => (
            <div key={t.id}>
              <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
                <button
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="flex items-center gap-2 flex-1 min-w-0 text-left"
                  aria-expanded={expanded === t.id}
                  title="Show members"
                >
                  {expanded === t.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{t.name}</span>
                </button>
                <span className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                  <Crown size={11} style={{ color: 'var(--text-tertiary)' }} />
                  {t.teamLead?.name ?? 'No lead'}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {t.memberCount ?? 0} member{(t.memberCount ?? 0) === 1 ? '' : 's'}
                </span>
                {canManage && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setEditTarget(t)} className="p-1 rounded text-slate-400 hover:text-blue-500" title="Edit team"><Pencil size={13} /></button>
                    <button onClick={() => setDeleteTarget(t)} className="p-1 rounded text-slate-400 hover:text-red-500" title="Delete team"><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
              {expanded === t.id && <TeamMembers team={t} canManage={canManage} />}
            </div>
          ))}
        </div>
      )}

      {showNew && <NewTeamDialog departments={departments} defaultDepartmentId={department.id} onClose={() => setShowNew(false)} />}
      {editTarget && <EditTeamDialog team={editTarget} departmentName={department.name} onClose={() => setEditTarget(null)} />}
      {deleteTarget && <DeleteTeamDialog team={deleteTarget} onClose={() => setDeleteTarget(null)} />}
    </div>
  );
}
