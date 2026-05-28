'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamApi, usersApi, workdayApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useSearchParams } from 'next/navigation';
import {
  Users, Search, Building2, Ticket, UserPlus, Check,
  Mail, Clock, ChevronDown, ChevronRight, Loader2,
} from 'lucide-react';

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN:       'bg-red-100 text-red-700',
  MANAGER:     'bg-orange-100 text-orange-700',
  TEAM_LEAD:   'bg-indigo-100 text-indigo-700',
  EMPLOYEE:    'bg-green-100 text-green-700',
  INTERN:      'bg-teal-100 text-teal-700',
};

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const initials = (name ?? '?').split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
  const cls = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-12 h-12 text-base' }[size];
  return (
    <div
      className={cn('rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0', cls)}
      style={{ background: 'linear-gradient(135deg,#1e40af 0%,#4f46e5 100%)' }}
    >
      {initials}
    </div>
  );
}

function WorkloadDots({ count }: { count: number }) {
  const level = count === 0 ? 'free' : count <= 2 ? 'light' : count <= 5 ? 'medium' : 'heavy';
  const colors = { free: 'bg-green-400', light: 'bg-yellow-400', medium: 'bg-orange-400', heavy: 'bg-red-400' };
  const labels = { free: 'Available', light: 'Light load', medium: 'Medium load', heavy: 'High load' };
  return (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
      <span className={cn('w-2 h-2 rounded-full', colors[level])} />
      {labels[level]}
    </span>
  );
}

// ─── My Team Card ─────────────────────────────────────────────────────────────
function TeamMemberCard({ user }: { user: any }) {
  return (
    <div className="apex-card p-4 flex items-start gap-4 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
            <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>{user.email}</p>
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Building2 size={11} /> {user.department?.name ?? 'No dept'}
          </span>
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <Ticket size={11} /> {user._count?.assignedTickets ?? user.ticketCount ?? 0} open tickets
          </span>
          <WorkloadDots count={user._count?.assignedTickets ?? user.ticketCount ?? 0} />
        </div>
      </div>
    </div>
  );
}

// ─── Directory Employee Card ──────────────────────────────────────────────────
function DirectoryCard({ user, isRequested, isLoading: loading, onRequest }: {
  user: any; isRequested: boolean; isLoading: boolean; onRequest: () => void;
}) {
  return (
    <div className="apex-card p-4 flex items-center gap-3 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate text-sm" style={{ color: 'var(--text-primary)' }}>{user.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{user.department?.name}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-tertiary)' }}><Ticket size={10} /> {user._count?.assignedTickets ?? 0} open</span>
          <WorkloadDots count={user._count?.assignedTickets ?? 0} />
        </div>
      </div>
      <button
        onClick={onRequest}
        disabled={isRequested || loading}
        className={cn(
          'flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-all flex-shrink-0',
          isRequested
            ? 'border-green-200 bg-green-50 text-green-700 cursor-default'
            : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50',
        )}
      >
        {loading ? <Loader2 size={12} className="animate-spin" /> : isRequested ? <><Check size={12} /> Requested</> : <><UserPlus size={12} /> Add</>}
      </button>
    </div>
  );
}

// ─── Collapsible Department Section (Super Admin company view) ────────────────
function DeptSection({ name, members }: { name: string; members: any[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="apex-card overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{name}</span>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{members.length} members</span>
        </div>
        {open
          ? <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />
          : <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />}
      </button>
      {open && (
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {members.map((m) => (
            <div
              key={m.id}
              className="flex items-center gap-3 px-5 py-3 transition-colors"
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <Avatar name={m.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>{m.email}</p>
              </div>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[m.role?.name] ?? 'bg-gray-100 text-gray-700')}>
                {m.role?.name}
              </span>
              <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: 'var(--text-tertiary)' }}>
                <Ticket size={10} /> {m._count?.assignedTickets ?? 0}
              </span>
              <WorkloadDots count={m._count?.assignedTickets ?? 0} />
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-tertiary)' }}>No members in this department</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Super Admin Company View ─────────────────────────────────────────────────
function SuperAdminCompanyView({ me }: { me: any }) {
  const [search, setSearch] = useState('');

  const { data: usersData, isLoading } = useQuery({
    queryKey: ['all-users-team'],
    queryFn: () => usersApi.getAll({ limit: 100 }) as Promise<any>,
  });

  const allUsers: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);

  const filtered = useMemo(() => {
    if (!search.trim()) return allUsers;
    const q = search.toLowerCase();
    return allUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department?.name?.toLowerCase().includes(q),
    );
  }, [allUsers, search]);

  // Group by department
  const byDept = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((u) => {
      const dept = u.department?.name ?? 'No Department';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(u);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Company Directory</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>All {allUsers.length} members across {byDept.length} departments</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', border: '1px solid var(--accent-border)' }}>
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{allUsers.length} total</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or department…"
          className="apex-input pl-9 pr-3 py-2"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="apex-card h-40 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {byDept.map(([dept, members]) => (
            <DeptSection key={dept} name={dept} members={members} />
          ))}
          {byDept.length === 0 && (
            <div className="apex-card border-dashed p-10 text-center">
              <Search size={28} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No members match your search</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Manager Multi-Dept Team View ────────────────────────────────────────────
function ManagerTeamView({ me }: { me: any }) {
  const [search, setSearch] = useState('');

  const { data: myTeamRaw, isLoading } = useQuery({
    queryKey: ['my-team-manager'],
    queryFn: () => usersApi.getMyTeam() as Promise<any[]>,
  });

  const allMembers: any[] = Array.isArray(myTeamRaw) ? myTeamRaw : [];

  const filtered = useMemo(() => {
    if (!search.trim()) return allMembers;
    const q = search.toLowerCase();
    return allMembers.filter(
      (u) => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q) || u.department?.name?.toLowerCase().includes(q),
    );
  }, [allMembers, search]);

  // Group by department
  const byDept = useMemo(() => {
    const map = new Map<string, any[]>();
    filtered.forEach((u) => {
      const dept = u.department?.name ?? 'No Department';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push(u);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>My Team</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {allMembers.length} members across {byDept.length} department{byDept.length !== 1 ? 's' : ''} you manage
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', border: '1px solid var(--accent-border)' }}>
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{allMembers.length} total</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or department…"
          className="apex-input pl-9 pr-3 py-2"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="apex-card h-40 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {byDept.map(([dept, members]) => (
            <DeptSection key={dept} name={dept} members={members} />
          ))}
          {byDept.length === 0 && (
            <div className="apex-card border-dashed p-10 text-center">
              <Search size={28} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {search ? 'No members match your search' : 'No team members found'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── TL / Employee Team View ──────────────────────────────────────────────────
function MyTeamView({ me }: { me: any }) {
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());
  const [loadingId, setLoadingId] = useState<string | null>(null);

  useEffect(() => {
    if (me?.id) {
      const stored = localStorage.getItem(`requestedIds_${me.id}`);
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            setRequestedIds(new Set(parsed));
          }
        } catch (e) {
          console.error('[Team] Failed to parse requestedIds from localStorage', e);
        }
      }
    }
  }, [me?.id]);

  const { data: directory = [], isLoading } = useQuery({
    queryKey: ['team-directory'],
    queryFn: () => teamApi.getDirectory() as Promise<any[]>,
  });

  const myDeptName = me?.department?.name ?? '';

  const myTeam = useMemo(
    () => directory.filter((u) => u.department?.name === myDeptName && u.id !== me?.id),
    [directory, me?.id, myDeptName],
  );

  const everyone = useMemo(
    () => directory.filter((u) => u.department?.name !== myDeptName && u.id !== me?.id),
    [directory, me?.id, myDeptName],
  );

  const departments = useMemo(
    () => Array.from(new Set(everyone.map((u) => u.department?.name).filter(Boolean) as string[])).sort(),
    [everyone],
  );

  const filtered = useMemo(() => {
    let list = everyone;
    if (deptFilter) list = list.filter((u) => u.department?.name === deptFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department?.name?.toLowerCase().includes(q));
    }
    return list;
  }, [everyone, deptFilter, search]);

  const pendingRequests = useMemo(
    () => directory.filter((u) => requestedIds.has(u.id)),
    [directory, requestedIds],
  );

  const handleRequest = async (targetUser: any) => {
    setLoadingId(targetUser.id);
    try {
      const res: any = await teamApi.sendRequest(
        targetUser.id,
        `Requested ${targetUser.name} (${targetUser.department?.name}) to join ${myDeptName} team`,
      );
      const newSet = new Set(requestedIds);
      newSet.add(targetUser.id);
      setRequestedIds(newSet);
      if (me?.id) {
        localStorage.setItem(`requestedIds_${me.id}`, JSON.stringify(Array.from(newSet)));
      }
      toast.success(res.message ?? 'Request sent!');
    } catch {
      toast.error('Failed to send request');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Team</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{myDeptName} — manage your team and request new members</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--accent-subtle)', border: '1px solid var(--accent-border)' }}>
          <Users size={14} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--accent-text)' }}>{myTeam.length} team members</span>
        </div>
      </div>

      {/* My Team */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>My Team — {myDeptName}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{myTeam.length}</span>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 h-24 animate-pulse" />)}
          </div>
        ) : myTeam.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myTeam.map((u) => <TeamMemberCard key={u.id} user={u} />)}
          </div>
        ) : (
          <div className="apex-card border-dashed p-10 text-center">
            <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>No team members in {myDeptName} yet</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Use the directory below to request additions</p>
          </div>
        )}
      </section>

      {/* Employee Directory */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-emerald-500" />
          <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Employee Directory</h3>
          <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}>{filtered.length} people</span>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or department…"
              className="apex-input pl-9 pr-3 py-2"
            />
          </div>
          <div className="relative">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="apex-select appearance-none pl-3 pr-8 py-2"
            >
              <option value="">All Departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="apex-card h-20 animate-pulse" />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map((u) => (
              <DirectoryCard
                key={u.id}
                user={u}
                isRequested={requestedIds.has(u.id)}
                isLoading={loadingId === u.id}
                onRequest={() => handleRequest(u)}
              />
            ))}
          </div>
        ) : (
          <div className="apex-card border-dashed p-10 text-center">
            <Search size={28} className="mx-auto mb-2" style={{ color: 'var(--text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No employees match your search</p>
          </div>
        )}
      </section>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-5 rounded-full bg-amber-400" />
            <h3 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>Pending Requests</h3>
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">{pendingRequests.length} pending</span>
          </div>
          <div className="apex-card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-tertiary)' }}>
                <tr>
                  <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Employee</th>
                  <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Department</th>
                  <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Role</th>
                  <th className="text-right text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Status</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                {pendingRequests.map((u) => (
                  <tr
                    key={u.id}
                    className="transition-colors"
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size="sm" />
                        <div>
                          <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                          <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}><Mail size={10} />{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3" style={{ color: 'var(--text-secondary)' }}>{u.department?.name}</td>
                    <td className="px-5 py-3">
                      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', ROLE_COLORS[u.role?.name] ?? 'bg-gray-100 text-gray-700')}>{u.role?.name}</span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full">
                        <Clock size={10} /> Pending approval
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>Requests sent to manager — they will approve or reject via their notification panel.</p>
        </section>
      )}
    </div>
  );
}

// ─── Status helpers ───────────────────────────────────────────────────────────
function fmtMin(minutes: number) {
  if (!minutes) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const STATUS_CONFIG: Record<string, { dot: string; label: string; color: string }> = {
  WORKING:    { dot: 'bg-green-500',  label: 'Working',     color: 'var(--color-success)' },
  ON_BREAK:   { dot: 'bg-orange-400', label: 'On Break',    color: 'var(--color-warning)' },
  IDLE:       { dot: 'bg-yellow-400', label: 'Idle',        color: 'var(--color-warning)' },
  ON_LEAVE:   { dot: 'bg-blue-500',   label: 'On Leave',    color: 'var(--color-info)' },
  LOGGED_OUT: { dot: 'bg-gray-400',   label: 'Ended day',   color: 'var(--text-secondary)' },
  OFFLINE:    { dot: 'bg-gray-300',   label: 'Not started', color: 'var(--text-tertiary)' },
  LOGGED_IN:  { dot: 'bg-yellow-300', label: 'Logged in',   color: 'var(--color-warning)' },
};

// ─── Live Status View ─────────────────────────────────────────────────────────
function LiveStatusView() {
  const { data: teamStatus = [], isLoading: teamLoading } = useQuery({
    queryKey: ['workday-team'],
    queryFn: () => workdayApi.getTeam() as Promise<any[]>,
    refetchInterval: 30000,
  });

  const members = Array.isArray(teamStatus) ? teamStatus : [];

  if (teamLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="apex-card p-4 h-14 animate-pulse" />
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="apex-card border-dashed p-10 text-center">
        <Users size={32} className="mx-auto mb-3" style={{ color: 'var(--text-tertiary)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No team members found</p>
      </div>
    );
  }

  return (
    <div className="apex-card overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b" style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--bg-tertiary)' }}>
          <tr>
            <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Member</th>
            <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Status</th>
            <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Work Time</th>
            <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Breaks</th>
            <th className="text-left text-xs font-semibold uppercase px-5 py-3" style={{ color: 'var(--text-secondary)' }}>Department</th>
          </tr>
        </thead>
        <tbody className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {members.map((m: any) => {
            const cfg = STATUS_CONFIG[m.workStatus] ?? STATUS_CONFIG.OFFLINE;
            return (
              <tr
                key={m.id}
                className="transition-colors"
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <Avatar name={m.name} size="sm" />
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 ${cfg.dot}`} style={{ borderColor: 'var(--surface-card)' }} />
                    </div>
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{m.name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{m.role?.name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: cfg.color }}>
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                    {m.onLeaveToday && (
                      <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{m.leaveType ?? 'Leave'}</span>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {fmtMin(m.workMinutesToday)}
                </td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {m.breakCount > 0 ? `${m.breakCount}x · ${fmtMin(m.breakMinutesToday)}` : '—'}
                </td>
                <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {m.department?.name ?? '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const { user: me } = useAuthStore();
  const [tab, setTab] = useState<'team' | 'live'>('team');

  const searchParams = useSearchParams();
  const queryString = searchParams.toString();

  useEffect(() => {
    const params = new URLSearchParams(queryString);
    const qTab = params.get('tab');
    if (qTab === 'live-status' || qTab === 'live') {
      setTab('live');
    } else if (qTab === 'team') {
      setTab('team');
    }
  }, [queryString]);

  const role = (me?.role as any)?.name ?? me?.role ?? '';
  const isHR = (me as any)?.isHR;
  const canSeeStatus = ['TEAM_LEAD', 'MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role) || isHR;
  const mode = typeof window !== 'undefined' ? localStorage.getItem('apexMode') ?? 'super_admin' : 'super_admin';
  const isSuperAdminCompanyMode = role === 'SUPER_ADMIN' && mode !== 'team_lead';

  // Super Admin in company (admin) mode → show all departments + Live Status tab
  if (isSuperAdminCompanyMode) {
    return (
      <div className="max-w-6xl mx-auto">
        {canSeeStatus && (
          <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
            <button
              onClick={() => setTab('team')}
              className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', tab === 'team' ? 'border-indigo-500' : 'border-transparent')}
              style={{ color: tab === 'team' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onMouseEnter={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              Company Directory
            </button>
            <button
              onClick={() => setTab('live')}
              className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === 'live' ? 'border-indigo-500' : 'border-transparent')}
              style={{ color: tab === 'live' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onMouseEnter={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Live Status
            </button>
          </div>
        )}
        {tab === 'live' ? <LiveStatusView /> : <SuperAdminCompanyView me={me} />}
      </div>
    );
  }

  // Manager → show multi-dept view with Live Status tab
  if (role === 'MANAGER') {
    return (
      <div className="max-w-6xl mx-auto">
        {canSeeStatus && (
          <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
            <button
              onClick={() => setTab('team')}
              className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', tab === 'team' ? 'border-indigo-500' : 'border-transparent')}
              style={{ color: tab === 'team' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onMouseEnter={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              My Team
            </button>
            <button
              onClick={() => setTab('live')}
              className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === 'live' ? 'border-indigo-500' : 'border-transparent')}
              style={{ color: tab === 'live' ? 'var(--accent)' : 'var(--text-secondary)' }}
              onMouseEnter={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
              Live Status
            </button>
          </div>
        )}
        {tab === 'live' ? <LiveStatusView /> : <ManagerTeamView me={me} />}
      </div>
    );
  }

  // TL, Employee, or Super Admin in team_lead mode → show own dept + directory + live tab
  return (
    <div className="max-w-6xl mx-auto">
      {canSeeStatus && (
        <div className="flex gap-1 mb-6 border-b" style={{ borderColor: 'var(--border-primary)' }}>
          <button
            onClick={() => setTab('team')}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors', tab === 'team' ? 'border-indigo-500' : 'border-transparent')}
            style={{ color: tab === 'team' ? 'var(--accent)' : 'var(--text-secondary)' }}
            onMouseEnter={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { if (tab !== 'team') e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            Team
          </button>
          <button
            onClick={() => setTab('live')}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5', tab === 'live' ? 'border-indigo-500' : 'border-transparent')}
            style={{ color: tab === 'live' ? 'var(--accent)' : 'var(--text-secondary)' }}
            onMouseEnter={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-primary)'; }}
            onMouseLeave={(e) => { if (tab !== 'live') e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Live Status
          </button>
        </div>
      )}
      {tab === 'live' && canSeeStatus ? <LiveStatusView /> : <MyTeamView me={me} />}
    </div>
  );
}
