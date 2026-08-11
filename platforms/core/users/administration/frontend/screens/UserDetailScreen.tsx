'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { usersApi, ticketsApi, leaveApi, projectsApi, workdayApi, dashboardApi } from '@/lib/api';
import {
  ArrowLeft, Mail, Building2, BadgeCheck, Calendar, Ticket, ExternalLink,
  AlertCircle, ChevronRight, Briefcase, Clock, MapPin, User, FileText,
  CreditCard, ShieldCheck, Download, Plus, Shield, RefreshCw, CheckCircle2, XCircle
} from 'lucide-react';
import Link from 'next/link';
import { PRIORITY_COLORS } from '@apex/shared-configuration';
import { STATUS_COLORS } from '@/lib/utils';
import { cn, formatDate } from '@apex/shared-utilities';
import toast from 'react-hot-toast';
import { useAuthStore } from '@apex/core-identity';

const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700 border border-purple-200',
  ADMIN: 'bg-red-100 text-red-700 border border-red-200',
  MANAGER: 'bg-orange-100 text-orange-700 border border-orange-200',
  TEAM_LEAD: 'bg-blue-100 text-blue-700 border border-blue-200',
  EMPLOYEE: 'bg-green-100 text-green-700 border border-green-200',
  INTERN: 'bg-slate-100 text-slate-600 border border-slate-200',
};

function Avatar({ name, avatar }: { name: string; avatar?: string }) {
  if (avatar) {
    return <img src={avatar} alt={name} className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg flex-shrink-0" />;
  }
  return (
    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-600 to-violet-600 text-white font-bold text-3xl flex items-center justify-center border-4 border-white shadow-lg flex-shrink-0">
      {name?.slice(0, 2).toUpperCase() || 'U'}
    </div>
  );
}

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const { user: currentUser } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'overview' | 'leaves' | 'tickets' | 'payroll'>('overview');
  const [uploading, setUploading] = useState(false);

  const fromContext = searchParams.get('from');
  const deptId = searchParams.get('deptId');
  const deptName = searchParams.get('deptName')
    ? decodeURIComponent(searchParams.get('deptName')!)
    : null;

  // 1. Fetch User Profile
  const { data: user, isLoading, isError } = useQuery({
    queryKey: ['user-profile', id],
    queryFn: () => usersApi.getProfile(id) as Promise<any>,
  });

  // 2. Fetch User Tickets
  const { data: ticketsData } = useQuery({
    queryKey: ['user-tickets', id],
    queryFn: () => ticketsApi.getAll({ assignedToId: id, limit: 20 }) as Promise<any>,
    enabled: !!id,
  });

  // 3. Fetch User Leave Balance
  const { data: leaveBalance } = useQuery({
    queryKey: ['user-leave-balance', id],
    queryFn: () => leaveApi.getBalance(id) as Promise<any>,
    enabled: !!id,
  });

  // 4. Fetch User Projects
  const { data: projectsData } = useQuery({
    queryKey: ['user-projects', id],
    queryFn: () => projectsApi.getAll({ userId: id }) as Promise<any>,
    enabled: !!id,
  });

  // 5. Fetch User Workday History
  const { data: workdayHistory } = useQuery({
    queryKey: ['user-workday-history', id],
    queryFn: () => workdayApi.getHistory(id) as Promise<any[]>,
    enabled: !!id,
  });

  // 6. Fetch User Activity Logs
  const { data: activityLogs } = useQuery({
    queryKey: ['user-activity-logs', id],
    queryFn: () => dashboardApi.getActivityFeed(20, id) as Promise<any[]>,
    enabled: !!id,
  });

  // 7. Fetch User Documents (only if HR/Admin/Self)
  const isHR = (currentUser as any)?.isHR || ['ADMIN', 'SUPER_ADMIN'].includes((currentUser as any)?.role?.name || '');
  const isSelf = currentUser?.id === id;
  const canSeeDocs = isHR || isSelf;

  const { data: documents } = useQuery({
    queryKey: ['user-documents', id],
    queryFn: () => usersApi.getDocuments(id) as Promise<any[]>,
    enabled: !!id && canSeeDocs,
    retry: false,
  });

  // Verify Document Mutation
  const verifyDocMutation = useMutation({
    mutationFn: ({ docId, status, rejectionReason }: { docId: string; status: string; rejectionReason?: string }) =>
      usersApi.verifyDocument(id, docId, status, rejectionReason),
    onSuccess: () => {
      toast.success('Document status updated');
      qc.invalidateQueries({ queryKey: ['user-documents', id] });
      qc.invalidateQueries({ queryKey: ['user-profile', id] });
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update document status');
    }
  });

  // Upload Document Mutation
  const handleUploadDoc = async (e: React.ChangeEvent<HTMLInputElement>, type: string) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await usersApi.uploadDocument(id, file, type);
      toast.success('Document uploaded successfully');
      qc.invalidateQueries({ queryKey: ['user-documents', id] });
    } catch {
      toast.error('Failed to upload document');
    } finally {
      setUploading(false);
    }
  };

  const tickets = ticketsData?.tickets ?? (Array.isArray(ticketsData) ? ticketsData : []);
  const projects = projectsData?.projects ?? (Array.isArray(projectsData) ? projectsData : []);

  const breadcrumbs = useMemo(() => {
    if (fromContext === 'department' && deptId && deptName) {
      return [
        { label: 'Departments', href: '/departments' },
        { label: deptName, href: `/departments/${deptId}` },
        { label: user?.name || 'Member', href: null },
      ];
    }
    return [
      { label: 'Users', href: '/users' },
      { label: user?.name || 'Member', href: null },
    ];
  }, [fromContext, deptId, deptName, user]);

  const handleBack = () => {
    if (fromContext === 'department' && deptId) {
      router.push(`/departments/${deptId}`);
    } else {
      router.push('/users');
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-indigo-600" />
        <p className="text-sm text-slate-500 font-medium">Loading employee profile...</p>
      </div>
    );
  }

  if (isError || !user) {
    return (
      <div className="flex flex-col items-center justify-center h-80 gap-3">
        <AlertCircle size={40} className="text-rose-500" />
        <h3 className="text-lg font-semibold text-slate-800">Profile Access Restricted</h3>
        <p className="text-sm text-slate-500 max-w-sm text-center">
          You might not have permission to view this user's profile, or the user does not exist.
        </p>
        <button onClick={() => router.back()} className="apex-btn-primary px-4 py-2 mt-2">
          Go Back
        </button>
      </div>
    );
  }

  const openTickets = tickets.filter((t) => !['DONE', 'CLOSED'].includes(t.status)).length;
  const completedTickets = tickets.filter((t) => ['DONE', 'CLOSED'].includes(t.status)).length;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Breadcrumbs */}
      <nav className="flex items-center gap-1 text-xs text-slate-500 flex-wrap">
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="w-3 h-3 text-slate-400" />}
            {crumb.href ? (
              <Link href={crumb.href} className="hover:text-indigo-600 transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="font-semibold text-slate-800">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>

      {/* Header & Back Button */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-slate-100 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
          >
            <ArrowLeft size={16} className="text-slate-600" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Employee Directory</h1>
            <p className="text-xs text-slate-500">View and manage employee profile and operational metrics</p>
          </div>
        </div>
      </div>

      {/* Profile banner & main details */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="h-32 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 relative" />
        <div className="px-6 pb-6 relative">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-5 -mt-12 mb-6">
            <Avatar name={user.name} avatar={user.avatar} />
            <div className="pb-1 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-2xl font-bold text-slate-800">{user.name}</h2>
                {user.role && (
                  <span className={cn('px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider', roleBadge[user.role.name] ?? 'bg-slate-100 text-slate-600')}>
                    {user.role.name}
                  </span>
                )}
              </div>
              <p className="text-sm font-medium text-slate-500 mt-1">{user.designation || 'Specialist'} • {user.department?.name || 'Department'}</p>
            </div>
            {!user.isActive && (
              <span className="bg-rose-100 text-rose-700 px-3 py-1 rounded-full text-xs font-bold border border-rose-200">
                Inactive
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2.5 text-slate-600">
              <Mail size={16} className="text-slate-400" />
              <span className="truncate font-medium">{user.email}</span>
            </div>
            <div className="flex items-center gap-2.5 text-slate-600">
              <Briefcase size={16} className="text-slate-400" />
              <span>{user.employmentType || 'Full-time'} • {user.workMode || 'Office'}</span>
            </div>
            <div className="flex items-center gap-2.5 text-slate-600">
              <Calendar size={16} className="text-slate-400" />
              <span>Joined {user.joiningDate ? formatDate(user.joiningDate) : 'Recently'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Nav */}
      <div className="flex border-b border-slate-200 gap-6 flex-wrap">
        {[
          { id: 'overview', label: 'Overview & Activity', icon: <User size={16} /> },
          { id: 'leaves', label: 'Leaves & Attendance', icon: <Clock size={16} /> },
          { id: 'tickets', label: 'Tickets & Projects', icon: <Ticket size={16} /> },
          { id: 'payroll', label: 'Payroll & Documents', icon: <FileText size={16} /> },
        ].map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                'flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-all',
                active
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="space-y-6">
        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Left 2 Cols: Details & Activity Feed */}
            <div className="md:col-span-2 space-y-6">
              {/* Detailed metrics */}
              <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Employment Details</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">Reporting Manager</p>
                    <p className="font-semibold text-slate-700 mt-0.5">{user.reportingManager || 'Not Assigned'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Team Lead</p>
                    <p className="font-semibold text-slate-700 mt-0.5">{user.teamLeadName || 'Not Assigned'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Work Shift</p>
                    <p className="font-semibold text-slate-700 mt-0.5">{user.shiftTiming || '9:30 AM - 6:30 PM'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Office Location</p>
                    <p className="font-semibold text-slate-700 mt-0.5">{user.workLocation || 'Pune HQ'}</p>
                  </div>
                </div>
              </div>

              {/* Scoped Activity Feed */}
              <div className="bg-white rounded-xl border border-slate-200">
                <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                  <h3 className="font-semibold text-slate-800">Recent Activity Logs</h3>
                  <span className="text-xs text-slate-400">Scoped actions</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {!activityLogs || activityLogs.length === 0 ? (
                    <p className="text-sm text-slate-400 text-center py-8">No recent activity logged for this user</p>
                  ) : (
                    activityLogs.map((log: any) => (
                      <div key={log.id} className="p-4 flex items-start gap-3">
                        <div className="w-2 h-2 rounded-full bg-indigo-500 mt-2 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-700 font-medium">
                            <span className="font-semibold text-slate-800">{log.user?.name}</span> performed{' '}
                            <span className="font-semibold text-indigo-600">{log.action}</span>
                          </p>
                          {log.details && Object.keys(log.details).length > 0 && (
                            <p className="text-xs text-slate-500 mt-1 font-mono bg-slate-50 p-1.5 rounded truncate">
                              {JSON.stringify(log.details)}
                            </p>
                          )}
                          <span className="text-[10px] text-slate-400 block mt-1">{new Date(log.createdAt).toLocaleString()}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Mini Stats */}
            <div className="space-y-6">
              <div className="bg-gradient-to-br from-indigo-900 to-violet-950 text-white rounded-xl p-6 shadow-md space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-indigo-300">Work Status</span>
                  <span className={cn(
                    'w-2.5 h-2.5 rounded-full',
                    user.currentStatus === 'WORKING' ? 'bg-green-400 animate-pulse' :
                    user.currentStatus === 'ON_BREAK' ? 'bg-amber-400' : 'bg-slate-400'
                  )} />
                </div>
                <div>
                  <p className="text-2xl font-black">{user.currentStatus || 'OFFLINE'}</p>
                  <p className="text-xs text-indigo-200 mt-1">Current status of workday session</p>
                </div>
              </div>

              {/* Tickets Snapshot */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h4 className="font-bold text-sm text-slate-800">Operational Stats</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <p className="text-xl font-bold text-orange-600">{openTickets}</p>
                    <p className="text-[10px] text-slate-500">Open Tickets</p>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg text-center">
                    <p className="text-xl font-bold text-green-600">{completedTickets}</p>
                    <p className="text-[10px] text-slate-500">Completed</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LEAVES TAB */}
        {activeTab === 'leaves' && (
          <div className="space-y-6">
            {/* Leave Balance Cards */}
            <div>
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-3">Leave Balances</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: 'Yearly Allocation', value: leaveBalance?.allocation ?? '12 days', color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
                  { label: 'Approved (Taken)', value: leaveBalance?.approved ? `${leaveBalance.approved} days` : '0 days', color: 'text-green-600 bg-green-50 border-green-100' },
                  { label: 'Pending Approval', value: leaveBalance?.pending ? `${leaveBalance.pending} days` : '0 days', color: 'text-amber-600 bg-amber-50 border-amber-100' },
                  { label: 'Remaining Balance', value: leaveBalance?.balance ? `${leaveBalance.balance} days` : '12 days', color: 'text-violet-600 bg-violet-50 border-violet-100' },
                ].map((stat, i) => (
                  <div key={i} className={cn('p-4 rounded-xl border text-center shadow-sm transition-all hover:scale-[1.02]', stat.color)}>
                    <p className="text-2xl font-bold mb-1">{stat.value}</p>
                    <p className="text-xs font-medium text-slate-500">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Attendance & Workday History Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h3 className="font-semibold text-slate-800">Attendance & Workday History</h3>
                <p className="text-xs text-slate-500 mt-0.5">Last 30 work sessions and active duration calculations</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 uppercase text-[10px] font-bold tracking-wider border-b border-slate-200">
                    <tr>
                      <th className="px-5 py-3">Date</th>
                      <th className="px-5 py-3">Status</th>
                      <th className="px-5 py-3">Clock In</th>
                      <th className="px-5 py-3">Clock Out</th>
                      <th className="px-5 py-3">Break Time</th>
                      <th className="px-5 py-3 font-semibold text-right">Work Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {!workdayHistory || workdayHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="px-5 py-8 text-center text-slate-400">
                          No workday/attendance records found
                        </td>
                      </tr>
                    ) : (
                      workdayHistory.map((session: any) => {
                        const dateStr = new Date(session.date).toLocaleDateString('en-IN', {
                          weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
                        });
                        const start = session.startWorkAt ? new Date(session.startWorkAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
                        const end = session.logoutAt ? new Date(session.logoutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
                        const workHrs = session.totalWorkMinutes ? `${(session.totalWorkMinutes / 60).toFixed(1)} hrs` : '—';
                        const breakHrs = session.totalBreakMinutes ? `${session.totalBreakMinutes} mins` : '0 mins';
                        return (
                          <tr key={session.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-3.5 font-medium">{dateStr}</td>
                            <td className="px-5 py-3.5">
                              <span className={cn(
                                'text-[10px] px-2 py-0.5 rounded-full font-bold uppercase border',
                                session.status === 'LOGGED_OUT' ? 'bg-slate-100 text-slate-600 border-slate-200' :
                                session.status === 'WORKING' ? 'bg-green-100 text-green-700 border-green-200' :
                                'bg-amber-100 text-amber-700 border-amber-200'
                              )}>
                                {session.status}
                              </span>
                            </td>
                            <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{start}</td>
                            <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{end}</td>
                            <td className="px-5 py-3.5 text-slate-500 font-mono text-xs">{breakHrs}</td>
                            <td className="px-5 py-3.5 font-bold text-slate-800 text-right font-mono text-xs">{workHrs}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TICKETS & PROJECTS TAB */}
        {activeTab === 'tickets' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Projects List */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Briefcase size={16} className="text-slate-400" />
                  Active Project Memberships
                </h3>
                <span className="text-xs text-indigo-600 font-semibold">{projects.length} Projects</span>
              </div>
              <div className="divide-y divide-slate-100">
                {projects.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">Not associated with any projects</p>
                ) : (
                  projects.map((proj: any) => (
                    <Link
                      key={proj.id}
                      href={`/projects/${proj.id}`}
                      className="p-4 hover:bg-slate-50 flex items-center justify-between transition-colors group"
                    >
                      <div>
                        <p className="text-sm font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{proj.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">ID: {proj.projectId} • {proj.status}</p>
                      </div>
                      <ExternalLink size={14} className="text-slate-300 group-hover:text-indigo-500 transition-colors" />
                    </Link>
                  ))
                )}
              </div>
            </div>

            {/* Assigned Tickets */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <Ticket size={16} className="text-slate-400" />
                  Recent Assigned Tickets
                </h3>
                <span className="text-xs text-slate-400 font-medium">({tickets.length})</span>
              </div>
              <div className="divide-y divide-slate-100">
                {tickets.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No tickets assigned</p>
                ) : (
                  tickets.map((t: any) => (
                    <Link
                      key={t.id}
                      href={`/tickets/${t.id}`}
                      className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 transition-colors group"
                    >
                      <span className="text-xs text-slate-400 font-mono w-16 flex-shrink-0">{t.ticketId}</span>
                      <p className="flex-1 text-sm text-slate-700 font-semibold truncate group-hover:text-indigo-600 transition-colors">{t.title}</p>
                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold uppercase', STATUS_COLORS[t.status] ?? 'bg-slate-100 text-slate-600')}>
                        {t.status}
                      </span>
                      <span className={cn('text-xs font-semibold', PRIORITY_COLORS[t.priority] ?? 'text-slate-500')}>
                        {t.priority}
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* PAYROLL & DOCUMENTS TAB */}
        {activeTab === 'payroll' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Payroll section (Masked by AccessPolicy) */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <CreditCard size={18} className="text-indigo-500" />
                  Payroll & Statutory details
                </h3>
                <Shield size={14} className="text-slate-400" />
              </div>

              {/* Show details or restricted warning */}
              {user.ctcAnnual === undefined ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                  <AlertCircle size={24} className="text-amber-500 animate-bounce" />
                  <p className="text-sm font-semibold text-slate-700">Access Restricted</p>
                  <p className="text-xs text-slate-400 max-w-xs">
                    You do not have access to view this employee's sensitive financial details.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-400">CTC (Annual)</p>
                    <p className="font-mono font-bold text-slate-800 mt-0.5">{user.ctcAnnual}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Basic Salary</p>
                    <p className="font-mono font-bold text-slate-800 mt-0.5">{user.basicSalary}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Bank Name</p>
                    <p className="font-semibold text-slate-800 mt-0.5">{user.bankName || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Account Number</p>
                    <p className="font-mono font-semibold text-slate-800 mt-0.5">{user.accountNumber || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">PAN Number</p>
                    <p className="font-mono font-semibold text-slate-800 mt-0.5">{user.panNumber || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-400">Aadhaar Number</p>
                    <p className="font-mono font-semibold text-slate-800 mt-0.5">{user.aadhaarNumber || '—'}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Documents Verification Section */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                  <FileText size={18} className="text-violet-500" />
                  Statutory Documents
                </h3>
                {canSeeDocs && (
                  <label className="cursor-pointer text-xs font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1">
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => handleUploadDoc(e, 'AADHAAR')}
                      disabled={uploading}
                    />
                    {uploading ? 'Uploading...' : '+ Upload'}
                  </label>
                )}
              </div>
              <div className="divide-y divide-slate-100">
                {!canSeeDocs ? (
                  <div className="p-8 text-center text-slate-400">
                    <AlertCircle className="mx-auto text-slate-300 mb-2" size={24} />
                    <p className="text-sm font-medium">Only HR/Admin or the owner can view documents</p>
                  </div>
                ) : !documents || documents.length === 0 ? (
                  <p className="text-sm text-slate-400 text-center py-8">No documents uploaded yet</p>
                ) : (
                  documents.map((doc: any) => (
                    <div key={doc.id} className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{doc.documentType}</p>
                          <p className="text-xs text-slate-400">{doc.fileName} ({(doc.fileSize / 1024).toFixed(0)} KB)</p>
                        </div>
                        <span className={cn(
                          'text-[10px] px-2 py-0.5 rounded-full font-bold border uppercase',
                          doc.verificationStatus === 'VERIFIED' ? 'bg-green-100 text-green-700 border-green-200' :
                          doc.verificationStatus === 'REJECTED' ? 'bg-red-100 text-red-600 border-red-200' :
                          'bg-amber-100 text-amber-700 border-amber-200 animate-pulse'
                        )}>
                          {doc.verificationStatus}
                        </span>
                      </div>

                      <div className="flex gap-2 justify-end">
                        <a
                          href={doc.fileUrl}
                          download={doc.fileName}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs border border-slate-200 px-3 py-1.5 rounded-lg bg-white font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          <Download size={12} />
                          Download/View
                        </a>

                        {/* Verify actions for HR/Admin */}
                        {isHR && doc.verificationStatus === 'Pending' && (
                          <>
                            <button
                              onClick={() => verifyDocMutation.mutate({ docId: doc.id, status: 'VERIFIED' })}
                              disabled={verifyDocMutation.isPending}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-colors"
                            >
                              <CheckCircle2 size={12} />
                              Verify
                            </button>
                            <button
                              onClick={() => {
                                const reason = prompt('Rejection reason:') || undefined;
                                verifyDocMutation.mutate({ docId: doc.id, status: 'REJECTED', rejectionReason: reason });
                              }}
                              disabled={verifyDocMutation.isPending}
                              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-lg transition-colors"
                            >
                              <XCircle size={12} />
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
