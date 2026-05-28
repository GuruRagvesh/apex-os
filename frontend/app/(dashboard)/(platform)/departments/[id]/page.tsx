'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { departmentsApi, usersApi, rolesApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import {
  ArrowLeft,
  Users,
  Ticket,
  FolderKanban,
  Clock,
  Edit2,
  Check,
  X,
  UserPlus,
  ExternalLink,
  AlertCircle,
  UserMinus,
  Crown,
} from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Breadcrumb } from '@/components/ui/breadcrumb';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-slate-100 text-slate-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  REVIEW: 'bg-purple-100 text-purple-700',
  DONE: 'bg-green-100 text-green-700',
  CLOSED: 'bg-slate-100 text-slate-500',
};

const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'text-slate-500',
  MEDIUM: 'text-blue-600',
  HIGH: 'text-orange-600',
  URGENT: 'text-red-600',
};

function Avatar({ name, avatar, size = 'sm' }: { name: string; avatar?: string; size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs';
  if (avatar) {
    return <img src={avatar} alt={name} className={`${dim} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`${dim} rounded-full bg-indigo-100 text-indigo-700 font-semibold flex items-center justify-center flex-shrink-0`}>
      {name?.charAt(0)?.toUpperCase()}
    </div>
  );
}

export default function DepartmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();

  const isAdmin = ADMIN_ROLES.includes(user?.role?.name ?? '');

  // Inline edit state
  const [editingName, setEditingName] = useState(false);
  const [nameVal, setNameVal] = useState('');

  // Add member modal
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');

  const { data: dept, isLoading, isError } = useQuery({
    queryKey: ['department', id],
    queryFn: () => departmentsApi.getOne(id) as Promise<any>,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any>,
    enabled: showAddMember,
  });
  const allUsers: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesApi.getAll() as Promise<any[]>,
    enabled: isAdmin,
  });

  // Users not already in this dept
  const nonMembers = allUsers.filter(
    (u: any) => u.departmentId !== id && memberSearch
      ? u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(memberSearch.toLowerCase())
      : u.departmentId !== id,
  );

  const patchMutation = useMutation({
    mutationFn: (data: any) => departmentsApi.patch(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['department', id] });
      qc.invalidateQueries({ queryKey: ['departments'] });
      toast.success('Department updated');
      setEditingName(false);
    },
    onError: () => toast.error('Failed to update department'),
  });

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => usersApi.update(userId, { departmentId: id }),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['department', id] });
      qc.invalidateQueries({ queryKey: ['departments'] });
      setShowAddMember(false);
      setSelectedUserId('');
      setMemberSearch('');
    },
    onError: () => toast.error('Failed to add member'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => usersApi.update(userId, { departmentId: null }),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['department', id] });
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
    onError: () => toast.error('Failed to remove member'),
  });

  const setTeamLeadMutation = useMutation({
    mutationFn: async (userId: string) => {
      const roles = Array.isArray(rolesData) ? rolesData : [];
      const tlRole = roles.find((r: any) => r.name === 'TEAM_LEAD');
      if (!tlRole) throw new Error('TEAM_LEAD role not found');
      return usersApi.update(userId, { roleId: tlRole.id });
    },
    onSuccess: () => {
      toast.success('Team lead set');
      qc.invalidateQueries({ queryKey: ['department', id] });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to set team lead'),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-60">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (isError || !dept) {
    return (
      <div className="flex flex-col items-center justify-center h-60 gap-3">
        <AlertCircle size={32} className="text-slate-300" />
        <p className="text-slate-500">Department not found</p>
        <button onClick={() => router.back()} className="text-sm text-blue-600 hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const color = dept.color || '#6366f1';

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Breadcrumb items={[
        { label: 'Departments', href: '/departments' },
        { label: dept.name },
      ]} />
      {/* Back + Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.push('/departments')}
          className="p-2 rounded-lg transition-colors mt-0.5"
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <ArrowLeft size={18} style={{ color: 'var(--text-secondary)' }} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            {/* Color badge */}
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            {/* Name + inline edit */}
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameVal}
                  onChange={(e) => setNameVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') patchMutation.mutate({ name: nameVal });
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="text-xl font-bold text-slate-800 border-b-2 border-indigo-500 outline-none bg-transparent"
                />
                <button
                  onClick={() => nameVal.trim() && patchMutation.mutate({ name: nameVal.trim() })}
                  className="p-1 text-green-600 hover:bg-green-50 rounded"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="p-1 text-slate-400 hover:bg-slate-100 rounded"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>{dept.name}</h1>
                {isAdmin && (
                  <button
                    onClick={() => { setNameVal(dept.name); setEditingName(true); }}
                    className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 hover:text-slate-600"
                  >
                    <Edit2 size={14} />
                  </button>
                )}
              </div>
            )}
          </div>
          {dept.description && (
            <p className="text-sm mt-1 ml-11" style={{ color: 'var(--text-secondary)' }}>{dept.description}</p>
          )}
        </div>
      </div>

      {/* Team Lead */}
      <div className="apex-card p-4 flex items-center gap-4">
        <div className="text-sm font-medium w-28 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>Team Lead</div>
        {dept.teamLead ? (
          <div className="flex items-center gap-3">
            <Avatar name={dept.teamLead.name} avatar={dept.teamLead.avatar} size="md" />
            <div>
              <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{dept.teamLead.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{dept.teamLead.role?.name}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-400 italic">No team lead assigned</p>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Members', value: dept.stats?.totalMembers ?? dept._count?.users ?? 0, icon: Users, color: 'text-blue-600 bg-blue-50' },
          { label: 'Active Tickets', value: dept.stats?.activeTickets ?? 0, icon: Ticket, color: 'text-orange-600 bg-orange-50' },
          { label: 'Pending Leave', value: dept.stats?.pendingLeave ?? 0, icon: Clock, color: 'text-purple-600 bg-purple-50' },
          { label: 'Projects', value: dept.stats?.projects ?? dept._count?.projects ?? 0, icon: FolderKanban, color: 'text-green-600 bg-green-50' },
        ].map((s) => (
          <div key={s.label} className="apex-card p-4 text-center">
            <div className={`w-10 h-10 rounded-xl ${s.color} flex items-center justify-center mx-auto mb-2`}>
              <s.icon size={18} />
            </div>
            <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{s.value}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Members List */}
      <div className="apex-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            Members
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
              ({dept.users?.length ?? 0})
            </span>
          </h2>
          {isAdmin && (
            <button
              onClick={() => setShowAddMember(true)}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <UserPlus size={15} />
              Add Member
            </button>
          )}
        </div>
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {dept.users?.length === 0 && (
            <p className="text-sm text-center py-8" style={{ color: 'var(--text-tertiary)' }}>No members yet</p>
          )}
          {dept.users?.map((m: any) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <div className="cursor-pointer flex items-center gap-3 flex-1 min-w-0" onClick={() => router.push(`/users/${m.id}?from=department&deptId=${dept.id}&deptName=${encodeURIComponent(dept.name)}`)}>
                <Avatar name={m.name} avatar={m.avatar} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.email}</p>
                </div>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0" style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent-text)', border: '1px solid var(--accent-border)' }}>
                {m.role?.name}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                {m._count?.assignedTickets ?? 0} tickets
              </span>
              {isAdmin && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  {m.role?.name !== 'TEAM_LEAD' && m.role?.name !== 'MANAGER' && (
                    <button
                      onClick={() => setTeamLeadMutation.mutate(m.id)}
                      disabled={setTeamLeadMutation.isPending}
                      className="p-1 text-slate-400 hover:text-amber-500 hover:bg-amber-50 rounded transition-colors"
                      title="Set as Team Lead"
                    >
                      <Crown size={13} />
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm(`Remove ${m.name} from this department?`)) removeMemberMutation.mutate(m.id); }}
                    disabled={removeMemberMutation.isPending}
                    className="p-1 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Remove from department"
                  >
                    <UserMinus size={13} />
                  </button>
                </div>
              )}
              <ExternalLink size={13} className="text-slate-300 cursor-pointer" onClick={() => router.push(`/users/${m.id}?from=department&deptId=${dept.id}&deptName=${encodeURIComponent(dept.name)}`)} />
            </div>
          ))}
        </div>
      </div>

      {/* Active Tickets */}
      {dept.tickets?.length > 0 && (
        <div className="apex-card overflow-hidden">
          <div className="px-5 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
            <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Active Tickets
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                (last {dept.tickets.length})
              </span>
            </h2>
          </div>
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {dept.tickets.map((t: any) => (
              <div
                key={t.id}
                className="flex items-center gap-3 px-5 py-3 cursor-pointer transition-colors"
                onClick={() => router.push(`/tickets/${t.id}`)}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span className="text-xs font-mono w-20 flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                  {t.ticketId}
                </span>
                <p className="flex-1 text-sm truncate" style={{ color: 'var(--text-primary)' }}>{t.title}</p>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-600'}`}
                >
                  {t.status}
                </span>
                <span
                  className={`text-xs font-semibold flex-shrink-0 ${PRIORITY_COLORS[t.priority] ?? 'text-slate-500'}`}
                >
                  {t.priority}
                </span>
                {t.assignedTo && (
                  <span className="text-xs text-slate-400 flex-shrink-0">{t.assignedTo.name}</span>
                )}
                <ExternalLink size={13} className="text-slate-300" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Member Modal */}
      {showAddMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="apex-card rounded-xl w-full max-w-sm p-6 shadow-2xl">
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
                  u.name.toLowerCase().includes(memberSearch.toLowerCase()) ||
                  u.email.toLowerCase().includes(memberSearch.toLowerCase()),
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
                <p className="text-sm text-center py-4" style={{ color: 'var(--text-tertiary)' }}>All users are already members</p>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button
                onClick={() => selectedUserId && addMemberMutation.mutate(selectedUserId)}
                disabled={!selectedUserId || addMemberMutation.isPending}
                className="apex-btn-primary flex-1 font-medium py-2.5 disabled:opacity-50 text-sm"
              >
                {addMemberMutation.isPending ? 'Adding...' : 'Add Member'}
              </button>
              <button
                onClick={() => {
                  setShowAddMember(false);
                  setSelectedUserId('');
                  setMemberSearch('');
                }}
                className="flex-1 border font-medium py-2.5 rounded-lg transition-colors text-sm"
                style={{ borderColor: 'var(--border-primary)', color: 'var(--text-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
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
