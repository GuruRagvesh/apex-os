'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
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
    <span className="flex items-center gap-1.5 text-xs text-slate-500">
      <span className={cn('w-2 h-2 rounded-full', colors[level])} />
      {labels[level]}
    </span>
  );
}

// ─── My Team Card ─────────────────────────────────────────────────────────────
function TeamMemberCard({ user }: { user: any }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-4 hover:border-indigo-200 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 truncate mt-0.5">{user.email}</p>
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Building2 size={11} /> {user.department?.name ?? 'No dept'}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500">
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
    <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center gap-3 hover:border-slate-300 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 truncate text-sm">{user.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
          <span className="text-xs text-slate-400">{user.department?.name}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-xs text-slate-400"><Ticket size={10} /> {user._count?.assignedTickets ?? 0} open</span>
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
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <span className="font-semibold text-slate-800">{name}</span>
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{members.length} members</span>
        </div>
        {open ? <ChevronDown size={16} className="text-slate-400" /> : <ChevronRight size={16} className="text-slate-400" />}
      </button>
      {open && (
        <div className="divide-y divide-slate-50">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 transition-colors">
              <Avatar name={m.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 truncate">{m.name}</p>
                <p className="text-xs text-slate-400 truncate">{m.email}</p>
              </div>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[m.role?.name] ?? 'bg-gray-100 text-gray-700')}>
                {m.role?.name}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
                <Ticket size={10} /> {m._count?.assignedTickets ?? 0}
              </span>
              <WorkloadDots count={m._count?.assignedTickets ?? 0} />
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-6">No members in this department</p>
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
          <h2 className="text-2xl font-bold text-slate-800">Company Directory</h2>
          <p className="text-slate-500 text-sm mt-1">All {allUsers.length} members across {byDept.length} departments</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100">
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{allUsers.length} total</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or department…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-white rounded-xl border border-slate-200 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {byDept.map(([dept, members]) => (
            <DeptSection key={dept} name={dept} members={members} />
          ))}
          {byDept.length === 0 && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
              <Search size={28} className="mx-auto text-slate-300 mb-2" />
              <p className="text-slate-500 text-sm">No members match your search</p>
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
      setRequestedIds((prev) => new Set(prev).add(targetUser.id));
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
          <h2 className="text-2xl font-bold text-slate-800">Team</h2>
          <p className="text-slate-500 text-sm mt-1">{myDeptName} — manage your team and request new members</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100">
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{myTeam.length} team members</span>
        </div>
      </div>

      {/* My Team */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <h3 className="font-semibold text-slate-800 text-lg">My Team — {myDeptName}</h3>
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{myTeam.length}</span>
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
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <Users size={32} className="mx-auto text-slate-300 mb-3" />
            <p className="text-slate-500 text-sm font-medium">No team members in {myDeptName} yet</p>
            <p className="text-slate-400 text-xs mt-1">Use the directory below to request additions</p>
          </div>
        )}
      </section>

      {/* Employee Directory */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-emerald-500" />
          <h3 className="font-semibold text-slate-800 text-lg">Employee Directory</h3>
          <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{filtered.length} people</span>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or department…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            />
          </div>
          <div className="relative">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-slate-600"
            >
              <option value="">All Departments</option>
              {departments.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 h-20 animate-pulse" />)}
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
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
            <Search size={28} className="mx-auto text-slate-300 mb-2" />
            <p className="text-slate-500 text-sm">No employees match your search</p>
          </div>
        )}
      </section>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-5 rounded-full bg-amber-400" />
            <h3 className="font-semibold text-slate-800 text-lg">Pending Requests</h3>
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">{pendingRequests.length} pending</span>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-3">Employee</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-3">Department</th>
                  <th className="text-left text-xs font-semibold text-slate-500 uppercase px-5 py-3">Role</th>
                  <th className="text-right text-xs font-semibold text-slate-500 uppercase px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {pendingRequests.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800">{u.name}</p>
                          <p className="text-xs text-slate-400 flex items-center gap-1"><Mail size={10} />{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600">{u.department?.name}</td>
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
          <p className="text-xs text-slate-400 mt-2">Requests sent to manager — they will approve or reject via their notification panel.</p>
        </section>
      )}
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function TeamPage() {
  const { user: me } = useAuthStore();

  const role = (me?.role as any)?.name ?? me?.role ?? '';
  const mode = typeof window !== 'undefined' ? localStorage.getItem('apexMode') ?? 'super_admin' : 'super_admin';
  const isSuperAdminCompanyMode = role === 'SUPER_ADMIN' && mode !== 'team_lead';

  // Super Admin in company (admin) mode → show all departments
  if (isSuperAdminCompanyMode) {
    return (
      <div className="max-w-6xl mx-auto">
        <SuperAdminCompanyView me={me} />
      </div>
    );
  }

  // TL, Employee, or Super Admin in team_lead mode → show own dept + directory
  return (
    <div className="max-w-6xl mx-auto">
      <MyTeamView me={me} />
    </div>
  );
}
