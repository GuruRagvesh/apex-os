'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@apex/core-identity';
import {
  ArrowLeft, Users, Building2, Edit2, Check, X, UserPlus, UserMinus,
  Crown, AlertCircle, ShieldAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { Breadcrumb } from '@apex/shared-ui/components/breadcrumb';

const MANAGE_ROLES = ['ADMIN', 'SUPER_ADMIN', 'MANAGER'];

function Avatar({ name, avatar, size = 'sm' }: { name?: string; avatar?: string; size?: 'sm' | 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'w-12 h-12 text-base' : size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  if (avatar) return <img src={avatar} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} />;
  return (
    <div className={`${dim} rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center flex-shrink-0`}>
      {(name ?? '?').charAt(0).toUpperCase()}
    </div>
  );
}

export default function TeamDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, hasHydrated } = useAuthStore();
  const qc = useQueryClient();

  const role = (user?.role as any)?.name ?? '';
  const canManage = MANAGE_ROLES.includes(role);

  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');
  const [editingLead, setEditingLead] = useState(false);
  const [leadVal, setLeadVal] = useState('');
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [newMemberRole, setNewMemberRole] = useState('');
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});

  const { data: team, isLoading, isError, error } = useQuery({
    queryKey: ['team', id],
    queryFn: () => teamsApi.getOne(id) as Promise<any>,
    enabled: hasHydrated && !!id,
  });

  const { data: deptUsersData } = useQuery({
    queryKey: ['users', { departmentId: team?.departmentId }],
    queryFn: () => usersApi.getAll({ departmentId: team.departmentId, limit: 100 }) as Promise<any>,
    enabled: hasHydrated && !!team?.departmentId && (showAddMember || editingLead),
  });
  const deptUsers: any[] = deptUsersData?.users ?? (Array.isArray(deptUsersData) ? deptUsersData : []);
  const memberIds = new Set((team?.members ?? []).map((m: any) => m.userId));
  const nonMembers = deptUsers.filter((u: any) => !memberIds.has(u.id));

  const updateMutation = useMutation({
    mutationFn: (data: { name?: string; teamLeadId?: string | null }) => teamsApi.update(id, data),
    onSuccess: () => {
      toast.success('Team updated');
      qc.invalidateQueries({ queryKey: ['team', id] });
      qc.invalidateQueries({ queryKey: ['teams'] });
      setEditingName(false);
      setEditingLead(false);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update team'),
  });

  const addMemberMutation = useMutation({
    mutationFn: () => teamsApi.addMember(id, { userId: selectedUserId, role: newMemberRole.trim() || undefined }),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['team', id] });
      setShowAddMember(false);
      setSelectedUserId('');
      setMemberSearch('');
      setNewMemberRole('');
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to add member'),
  });

  const updateMemberMutation = useMutation({
    mutationFn: (vars: { userId: string; roleText: string }) =>
      teamsApi.updateMember(id, vars.userId, { role: vars.roleText }),
    onSuccess: () => {
      toast.success('Member role updated');
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update member role'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(id, userId),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['team', id] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to remove member'),
  });

  if (!hasHydrated || isLoading) {
    return (
      <div className="flex items-center justify-center h-60">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
      </div>
    );
  }

  if (isError || !team) {
    const message = (error as any)?.message || 'This team could not be located';
    return (
      <div className="max-w-xl mx-auto apex-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-danger-bg)' }}>
          <ShieldAlert size={24} style={{ color: 'var(--color-danger)' }} />
        </div>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{message}</p>
        <button onClick={() => router.push('/teams')} className="apex-btn apex-btn-secondary inline-flex justify-center">
          Back to Teams
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Breadcrumb items={[{ label: 'Teams', href: '/teams' }, { label: team.name }]} />

      {/* Back + Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.push('/teams')}
          className="p-2 rounded-lg transition-colors mt-0.5"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)' }}>
              <Users size={16} style={{ color: 'var(--accent)' }} />
            </div>
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nameVal.trim()) updateMutation.mutate({ name: nameVal.trim() });
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="text-xl font-bold border-b-2 border-indigo-500 outline-none bg-transparent"
                  style={{ color: 'var(--text-primary)' }}
                />
                <button onClick={() => nameVal.trim() && updateMutation.mutate({ name: nameVal.trim() })} className="p-1 text-green-600 hover:bg-green-50 rounded">
                  <Check size={16} />
                </button>
                <button onClick={() => setEditingName(false)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{team.name}</h1>
                {canManage && (
                  <button
                    onClick={() => { setNameVal(team.name); setEditingName(true); }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
          <p className="text-xs mt-1 ml-11 flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
            <Building2 size={11} /> {team.department?.name ?? '-'}
          </p>
        </div>
      </div>

      {/* Team Lead */}
      <div className="apex-card p-4 flex items-center gap-4 flex-wrap">
        <div className="text-sm font-medium w-28 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>Team Lead</div>
        {editingLead ? (
          <div className="flex items-center gap-2 flex-1">
            <select value={leadVal} onChange={(e) => setLeadVal(e.target.value)} className="apex-select flex-1 max-w-xs">
              <option value="">No team lead</option>
              {deptUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role?.name})</option>)}
            </select>
            <button
              onClick={() => updateMutation.mutate({ teamLeadId: leadVal || null })}
              disabled={updateMutation.isPending}
              className="p-1 text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
            >
              <Check size={16} />
            </button>
            <button onClick={() => setEditingLead(false)} className="p-1 text-slate-400 hover:bg-slate-100 rounded">
              <X size={16} />
            </button>
          </div>
        ) : (
          <>
            {team.teamLead ? (
              <div className="flex items-center gap-3">
                <Avatar name={team.teamLead.name} avatar={team.teamLead.avatar} size="md" />
                <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{team.teamLead.name}</p>
              </div>
            ) : (
              <p className="text-sm italic" style={{ color: 'var(--text-tertiary)' }}>No team lead assigned</p>
            )}
            {canManage && (
              <button
                onClick={() => { setLeadVal(team.teamLeadId ?? ''); setEditingLead(true); }}
                className="text-xs font-medium ml-auto"
                style={{ color: 'var(--accent)' }}
              >
                {team.teamLead ? 'Change' : 'Assign'}
              </button>
            )}
          </>
        )}
      </div>

      {/* Members */}
      <div className="apex-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Members
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>({team.members?.length ?? 0})</span>
          </h2>
          {canManage && (
            <button onClick={() => setShowAddMember(true)} className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--accent)' }}>
              <UserPlus size={15} /> Add Member
            </button>
          )}
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {(team.members ?? []).length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No members yet</p>
          )}
          {(team.members ?? []).map((m: any) => {
            const draft = roleDrafts[m.userId] ?? m.role ?? '';
            const isLead = team.teamLeadId === m.userId;
            return (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                <Avatar name={m.user?.name} avatar={m.user?.avatar} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                    {m.user?.name}
                    {isLead && <Crown size={12} style={{ color: 'var(--color-warning)' }} aria-label="Team lead" />}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.user?.email}</p>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}>
                  {m.user?.role?.name}
                </span>
                {canManage ? (
                  <input
                    value={draft}
                    onChange={(e) => setRoleDrafts((d) => ({ ...d, [m.userId]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && draft.trim() && draft !== m.role) {
                        updateMemberMutation.mutate({ userId: m.userId, roleText: draft.trim() });
                      }
                    }}
                    placeholder="MEMBER"
                    className="apex-input w-28 py-1 text-xs flex-shrink-0"
                    title="Team member role text - press Enter to save"
                  />
                ) : (
                  <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>{m.role}</span>
                )}
                {canManage && draft.trim() && draft !== m.role && (
                  <button
                    onClick={() => updateMemberMutation.mutate({ userId: m.userId, roleText: draft.trim() })}
                    disabled={updateMemberMutation.isPending}
                    className="p-1 text-green-600 hover:bg-green-50 rounded flex-shrink-0 disabled:opacity-50"
                    title="Save role"
                  >
                    <Check size={14} />
                  </button>
                )}
                {canManage && (
                  <button
                    onClick={() => { if (confirm(`Remove ${m.user?.name} from this team?`)) removeMemberMutation.mutate(m.userId); }}
                    disabled={removeMemberMutation.isPending}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors flex-shrink-0"
                    title="Remove from team"
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <h3 className="font-bold text-lg mb-4" style={{ color: 'var(--text-primary)' }}>Add Member</h3>
            <input
              type="text"
              placeholder="Search by name or email..."
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              className="apex-input mb-3"
              autoFocus
            />
            <div className="max-h-52 overflow-y-auto space-y-1">
              {nonMembers
                .filter((u: any) =>
                  !memberSearch ||
                  u.name?.toLowerCase().includes(memberSearch.toLowerCase()) ||
                  u.email?.toLowerCase().includes(memberSearch.toLowerCase()),
                )
                .slice(0, 20)
                .map((u: any) => (
                  <div
                    key={u.id}
                    onClick={() => setSelectedUserId(u.id)}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors"
                    style={selectedUserId === u.id
                      ? { backgroundColor: 'var(--accent-subtle)', border: '1px solid var(--accent-border)' }
                      : { border: '1px solid transparent' }}
                    onMouseEnter={(e) => { if (selectedUserId !== u.id) e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                    onMouseLeave={(e) => { if (selectedUserId !== u.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <Avatar name={u.name} avatar={u.avatar} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{u.email}</p>
                    </div>
                    <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{u.role?.name}</span>
                  </div>
                ))}
              {nonMembers.length === 0 && (
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>
                  Everyone in this department is already a member
                </p>
              )}
            </div>
            <div className="mt-3">
              <label className="apex-label">Member role (optional)</label>
              <input
                type="text"
                placeholder="MEMBER"
                value={newMemberRole}
                onChange={(e) => setNewMemberRole(e.target.value)}
                className="apex-input"
              />
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => selectedUserId && addMemberMutation.mutate()}
                disabled={!selectedUserId || addMemberMutation.isPending}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {addMemberMutation.isPending ? 'Adding...' : 'Add Member'}
              </button>
              <button
                onClick={() => { setShowAddMember(false); setSelectedUserId(''); setMemberSearch(''); setNewMemberRole(''); }}
                className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
