'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { teamApi, usersApi, workdayApi } from '@/lib/api';
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
    <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
      <span className={cn('w-2 h-2 rounded-full', colors[level])} />
      {labels[level]}
    </span>
  );
}

// ─── My Team Card ─────────────────────────────────────────────────────────────
function TeamMemberCard({ user }: { user: any }) {
  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex items-start gap-4 hover:border-indigo-200 dark:hover:border-indigo-700 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="lg" />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-slate-800 dark:text-gray-200 truncate">{user.name}</p>
            <p className="text-xs text-slate-500 dark:text-gray-400 truncate mt-0.5">{user.email}</p>
          </div>
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400">
            <Building2 size={11} /> {user.department?.name ?? 'No dept'}
          </span>
          <span className="flex items-center gap-1 text-xs text-slate-500 dark:text-gray-400">
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
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4 flex items-center gap-3 hover:border-slate-300 dark:hover:border-gray-600 hover:shadow-sm transition-all">
      <Avatar name={user.name} size="md" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-slate-800 dark:text-gray-200 truncate text-sm">{user.name}</p>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', ROLE_COLORS[user.role?.name] ?? 'bg-gray-100 text-gray-700')}>
            {user.role?.name}
          </span>
          <span className="text-xs text-slate-400 dark:text-gray-500">{user.department?.name}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5">
          <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-gray-500"><Ticket size={10} /> {user._count?.assignedTickets ?? 0} open</span>
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
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <span className="font-semibold text-slate-800 dark:text-white">{name}</span>
          <span className="text-xs bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{members.length} members</span>
        </div>
        {open ? <ChevronDown size={16} className="text-slate-400 dark:text-gray-500" /> : <ChevronRight size={16} className="text-slate-400 dark:text-gray-500" />}
      </button>
      {open && (
        <div className="divide-y divide-slate-50 dark:divide-gray-800">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
              <Avatar name={m.name} size="sm" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800 dark:text-gray-200 truncate">{m.name}</p>
                <p className="text-xs text-slate-400 dark:text-gray-500 truncate">{m.email}</p>
              </div>
              <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0', ROLE_COLORS[m.role?.name] ?? 'bg-gray-100 text-gray-700')}>
                {m.role?.name}
              </span>
              <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-gray-500 flex-shrink-0">
                <Ticket size={10} /> {m._count?.assignedTickets ?? 0}
              </span>
              <WorkloadDots count={m._count?.assignedTickets ?? 0} />
            </div>
          ))}
          {members.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-gray-500 text-center py-6">No members in this department</p>
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
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Company Directory</h2>
          <p className="text-slate-500 dark:text-gray-400 text-sm mt-1">All {allUsers.length} members across {byDept.length} departments</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{allUsers.length} total</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or department…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {byDept.map(([dept, members]) => (
            <DeptSection key={dept} name={dept} members={members} />
          ))}
          {byDept.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 p-10 text-center">
              <Search size={28} className="mx-auto text-slate-300 dark:text-gray-600 mb-2" />
              <p className="text-slate-500 dark:text-gray-400 text-sm">No members match your search</p>
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
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">My Team</h2>
          <p className="text-slate-500 dark:text-gray-400 text-sm mt-1">
            {allMembers.length} members across {byDept.length} department{byDept.length !== 1 ? 's' : ''} you manage
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
          <Users size={14} className="text-indigo-600" />
          <span className="text-sm font-semibold text-indigo-700">{allMembers.length} total</span>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or department…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
        />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="h-40 bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-4">
          {byDept.map(([dept, members]) => (
            <DeptSection key={dept} name={dept} members={members} />
          ))}
          {byDept.length === 0 && (
            <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 p-10 text-center">
              <Search size={28} className="mx-auto text-slate-300 dark:text-gray-600 mb-2" />
              <p className="text-slate-500 dark:text-gray-400 text-sm">
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
          <h2 className="text-2xl font-bold text-slate-800 dark:text-white">Team</h2>
          <p className="text-slate-500 dark:text-gray-400 text-sm mt-1">{myDeptName} — manage your team and request new members</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
          <Users size={14} className="text-indigo-600 dark:text-indigo-400" />
          <span className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">{myTeam.length} team members</span>
        </div>
      </div>

      {/* My Team */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-indigo-500" />
          <h3 className="font-semibold text-slate-800 dark:text-white text-lg">My Team — {myDeptName}</h3>
          <span className="text-xs bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{myTeam.length}</span>
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
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 p-10 text-center">
            <Users size={32} className="mx-auto text-slate-300 dark:text-gray-600 mb-3" />
            <p className="text-slate-500 dark:text-gray-400 text-sm font-medium">No team members in {myDeptName} yet</p>
            <p className="text-slate-400 dark:text-gray-500 text-xs mt-1">Use the directory below to request additions</p>
          </div>
        )}
      </section>

      {/* Employee Directory */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-5 rounded-full bg-emerald-500" />
          <h3 className="font-semibold text-slate-800 dark:text-white text-lg">Employee Directory</h3>
          <span className="text-xs bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-400 px-2 py-0.5 rounded-full">{filtered.length} people</span>
        </div>
        <div className="flex gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, or department…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
            />
          </div>
          <div className="relative">
            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-900 text-slate-600 dark:text-gray-400"
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
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 p-10 text-center">
            <Search size={28} className="mx-auto text-slate-300 dark:text-gray-600 mb-2" />
            <p className="text-slate-500 dark:text-gray-400 text-sm">No employees match your search</p>
          </div>
        )}
      </section>

      {/* Pending Requests */}
      {pendingRequests.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-5 rounded-full bg-amber-400" />
            <h3 className="font-semibold text-slate-800 dark:text-white text-lg">Pending Requests</h3>
            <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">{pendingRequests.length} pending</span>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800">
                <tr>
                  <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Employee</th>
                  <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Department</th>
                  <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Role</th>
                  <th className="text-right text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
                {pendingRequests.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size="sm" />
                        <div>
                          <p className="font-medium text-slate-800 dark:text-gray-200">{u.name}</p>
                          <p className="text-xs text-slate-400 dark:text-gray-500 flex items-center gap-1"><Mail size={10} />{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-600 dark:text-gray-400">{u.department?.name}</td>
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
          <p className="text-xs text-slate-400 dark:text-gray-500 mt-2">Requests sent to manager — they will approve or reject via their notification panel.</p>
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

const STATUS_CONFIG: Record<string, { dot: string; label: string; text: string }> = {
  WORKING:    { dot: 'bg-green-500',  label: 'Working',     text: 'text-green-700 dark:text-green-400' },
  ON_BREAK:   { dot: 'bg-orange-400', label: 'On Break',    text: 'text-orange-700 dark:text-orange-400' },
  IDLE:       { dot: 'bg-yellow-400', label: 'Idle',        text: 'text-yellow-700 dark:text-yellow-400' },
  ON_LEAVE:   { dot: 'bg-blue-500',   label: 'On Leave',    text: 'text-blue-700 dark:text-blue-400' },
  LOGGED_OUT: { dot: 'bg-gray-400',   label: 'Ended day',   text: 'text-gray-500 dark:text-gray-400' },
  OFFLINE:    { dot: 'bg-gray-300',   label: 'Not started', text: 'text-gray-400 dark:text-gray-500' },
  LOGGED_IN:  { dot: 'bg-yellow-300', label: 'Logged in',   text: 'text-yellow-600 dark:text-yellow-400' },
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
          <div key={i} className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 p-4 h-14 animate-pulse" />
        ))}
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-dashed border-slate-300 dark:border-gray-700 p-10 text-center">
        <Users size={32} className="mx-auto text-slate-300 dark:text-gray-600 mb-3" />
        <p className="text-slate-500 dark:text-gray-400 text-sm">No team members found</p>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-slate-200 dark:border-gray-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 dark:border-gray-800 bg-slate-50 dark:bg-gray-800">
          <tr>
            <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Member</th>
            <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Status</th>
            <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Work Time</th>
            <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Breaks</th>
            <th className="text-left text-xs font-semibold text-slate-500 dark:text-gray-400 uppercase px-5 py-3">Department</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50 dark:divide-gray-800">
          {members.map((m: any) => {
            const cfg = STATUS_CONFIG[m.workStatus] ?? STATUS_CONFIG.OFFLINE;
            return (
              <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-gray-800 transition-colors">
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="relative">
                      <Avatar name={m.name} size="sm" />
                      <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${cfg.dot}`} />
                    </div>
                    <div>
                      <p className="font-medium text-slate-800 dark:text-gray-200">{m.name}</p>
                      <p className="text-xs text-slate-400 dark:text-gray-500">{m.role?.name}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className={`flex items-center gap-1.5 text-xs font-medium ${cfg.text}`}>
                    <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                    {cfg.label}
                    {m.onLeaveToday && (
                      <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">{m.leaveType ?? 'Leave'}</span>
                    )}
                  </span>
                </td>
                <td className="px-5 py-3 text-slate-600 dark:text-gray-400">
                  {fmtMin(m.workMinutesToday)}
                </td>
                <td className="px-5 py-3 text-slate-500 dark:text-gray-400 text-xs">
                  {m.breakCount > 0 ? `${m.breakCount}x · ${fmtMin(m.breakMinutesToday)}` : '—'}
                </td>
                <td className="px-5 py-3 text-slate-500 dark:text-gray-400 text-xs">
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

  const role = (me?.role as any)?.name ?? me?.role ?? '';
  const isHR = (me as any)?.isHR;
  const canSeeStatus = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(role) || isHR;
  const mode = typeof window !== 'undefined' ? localStorage.getItem('apexMode') ?? 'super_admin' : 'super_admin';
  const isSuperAdminCompanyMode = role === 'SUPER_ADMIN' && mode !== 'team_lead';

  // Super Admin in company (admin) mode → show all departments + Live Status tab
  if (isSuperAdminCompanyMode) {
    return (
      <div className="max-w-6xl mx-auto">
        {canSeeStatus && (
          <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-gray-700">
            <button
              onClick={() => setTab('team')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === 'team'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
              )}
            >
              Company Directory
            </button>
            <button
              onClick={() => setTab('live')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                tab === 'live'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
              )}
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
          <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-gray-700">
            <button
              onClick={() => setTab('team')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                tab === 'team'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
              )}
            >
              My Team
            </button>
            <button
              onClick={() => setTab('live')}
              className={cn(
                'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
                tab === 'live'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
              )}
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
        <div className="flex gap-1 mb-6 border-b border-slate-200 dark:border-gray-700">
          <button
            onClick={() => setTab('team')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
              tab === 'team'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
            )}
          >
            Team
          </button>
          <button
            onClick={() => setTab('live')}
            className={cn(
              'px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5',
              tab === 'live'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                : 'border-transparent text-slate-500 dark:text-gray-400 hover:text-slate-700 dark:hover:text-gray-200',
            )}
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
