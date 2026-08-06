'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, departmentsApi, eventsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, PROJECT_STATUS_COLORS, PRIORITY_COLORS, PROJECT_STATUS_LABELS, PRIORITY_LABELS, formatDate, getInitials, formatRelativeTime } from '@/lib/utils';
import { ArrowLeft, Ticket, Users, Edit3, Trash2, Activity, UserPlus, X } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { TicketRow } from '@/components/tickets/ticket-row';
import { Breadcrumb } from '@/components/ui/breadcrumb';

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const canEdit = ['MANAGER', 'ADMIN', 'SUPER_ADMIN', 'TEAM_LEAD'].includes(roleName);
  const canDelete = ['ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', status: '', priority: '', departmentId: '', endDate: '' });

  const [showAddMember, setShowAddMember] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [memberRole, setMemberRole] = useState('MEMBER');

  const { data: project, isLoading, error, isError } = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.getOne(id) as Promise<any>,
    refetchOnWindowFocus: true,
  });

  const { data: allEvents = [], isError: isEventsError, refetch: refetchEvents } = useQuery({
    queryKey: ['project-activity', id],
    queryFn: () => eventsApi.getAll({ limit: 250 }) as Promise<any>,
    staleTime: 30000,
  });

  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any>,
    enabled: showAddMember,
  });
  const usersList = Array.isArray(allUsers) ? allUsers : (allUsers?.users || []);

  const updateMutation = useMutation({
    mutationFn: (data: any) => projectsApi.update(id, data),
    onSuccess: () => {
      toast.success('Project updated');
      qc.invalidateQueries({ queryKey: ['project', id] });
      qc.invalidateQueries({ queryKey: ['projects'] });
      setEditing(false);
    },
    onError: (err: any) => toast.error(err?.message ?? 'Update failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => projectsApi.remove(id),
    onSuccess: () => {
      toast.success('Project deleted');
      qc.invalidateQueries({ queryKey: ['projects'] });
      router.push('/projects');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Delete failed'),
  });

  const addMemberMutation = useMutation({
    mutationFn: (data: { userId: string, role: string }) => projectsApi.addMember(id, data.userId, data.role),
    onSuccess: () => {
      toast.success('Member added');
      qc.invalidateQueries({ queryKey: ['project', id] });
      setShowAddMember(false);
      setSelectedUserId('');
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to add member'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => projectsApi.removeMember(id, userId),
    onSuccess: () => {
      toast.success('Member removed');
      qc.invalidateQueries({ queryKey: ['project', id] });
    },
    onError: (err: any) => toast.error(err?.message ?? 'Failed to remove member'),
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
    enabled: editing,
  });

  const handleEditOpen = () => {
    setForm({
      name: project?.name ?? '',
      description: project?.description ?? '',
      status: project?.status ?? 'ACTIVE',
      priority: project?.priority ?? 'MEDIUM',
      departmentId: project?.departmentId ?? '',
      endDate: project?.endDate ? new Date(project.endDate).toISOString().split('T')[0] : '',
    });
    setEditing(true);
  };

  const handleDelete = () => {
    if (confirm('Delete this project? This cannot be undone.')) deleteMutation.mutate();
  };

  if (isLoading) return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>;
  if (isError) {
    const msg = (error as any)?.message || 'An error occurred loading this project';
    return <div className="text-center py-12 text-red-500">{msg}</div>;
  }
  if (!project) return <div className="text-center py-12 text-slate-500">This project could not be located</div>;

  // Use backend-computed progress (ticketStats.done / ticketStats.total).
  // Falls back to client-side calculation only if the backend field is absent (e.g. old API).
  const progress: number = project.progress ??
    (project.ticketStats?.total > 0
      ? Math.round((project.ticketStats.done / project.ticketStats.total) * 100)
      : (project.tickets?.length
          ? Math.round(
              (project.tickets.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length /
                project.tickets.length) * 100,
            )
          : 0));

  const tickets = project.tickets || [];
  const totalTickets = tickets.length;
  const doneTickets = tickets.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length;
  const activeCount = tickets.filter((t: any) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;
  const reviewCount = tickets.filter((t: any) => t.status === 'REVIEW').length;
  const overdueCount = tickets.filter((t: any) => {
    if (t.status === 'DONE' || t.status === 'CLOSED') return false;
    const deadline = t.executionDueAt || t.dueDate;
    return deadline && new Date(deadline) < new Date();
  }).length;

  let healthLabel = "Healthy";
  let healthColor = "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/20 dark:text-green-400 dark:border-green-800";
  if (overdueCount > 0) {
    healthLabel = "At Risk";
    healthColor = "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/20 dark:text-red-400 dark:border-red-800";
  } else if (reviewCount > 0) {
    healthLabel = "Needs Review";
    healthColor = "bg-yellow-50 text-yellow-700 border-yellow-250 dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-800";
  } else if (totalTickets === 0) {
    healthLabel = "No Work";
    healthColor = "bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-800";
  } else if (progress === 100) {
    healthLabel = "Completed";
    healthColor = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800";
  }

  // Filter events for this project
  const ticketIds = project.tickets?.map((t: any) => t.id) || [];
  const projectEvents = allEvents.filter((ev: any) => {
    if (ev.entityType === 'Project' && ev.entityId === project.id) return true;
    if (ev.entityType === 'Ticket' && ticketIds.includes(ev.entityId)) return true;
    return false;
  });

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <Breadcrumb items={[
        { label: 'Projects', href: '/projects' },
        { label: `${project.projectId} — ${project.name}` },
      ]} />
      <div className="flex items-start gap-3">
        <Link href="/projects" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft size={18} className="text-slate-500" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-slate-400 font-mono text-sm">{project.projectId}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', PROJECT_STATUS_COLORS[project.status])}>{PROJECT_STATUS_LABELS[project.status] ?? project.status}</span>
            <span className={cn('text-xs px-2 py-0.5 rounded font-medium', PRIORITY_COLORS[project.priority])}>{PRIORITY_LABELS[project.priority] ?? project.priority}</span>
          </div>
          <h2 className="text-xl font-bold text-slate-800">{project.name}</h2>
          {project.description && <p className="text-sm text-slate-500 mt-1">{project.description}</p>}
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <button onClick={handleEditOpen} className="apex-btn-secondary flex items-center gap-1.5 text-sm">
              <Edit3 size={13} /> Edit
            </button>
          )}
          {canDelete && (
            <button onClick={handleDelete} disabled={deleteMutation.isPending} className="flex items-center gap-1.5 text-sm px-3 py-1.5 border border-red-200 rounded-lg hover:bg-red-50 text-red-600 disabled:opacity-50">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={(e) => e.target === e.currentTarget && setEditing(false)}>
          <div className="bg-white rounded-xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-5">Edit Project</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
                <textarea className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg resize-none" rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                  <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                    {['ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Priority</label>
                  <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                    {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Department</label>
                  <select className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
                    <option value="">None</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">End Date</label>
                  <input type="date" className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => updateMutation.mutate({
                  ...form,
                  departmentId: form.departmentId || null,
                  endDate: form.endDate ? new Date(form.endDate).toISOString() : null,
                })}
                disabled={updateMutation.isPending}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 rounded-lg disabled:opacity-50"
              >
                {updateMutation.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setEditing(false)} className="flex-1 border border-slate-200 text-slate-600 py-2 rounded-lg">Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* Health & Progress Overview */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-slate-705 text-sm">Project Health</h3>
                <span className={cn('text-xs px-2 py-0.5 rounded-full font-semibold border', healthColor)}>{healthLabel}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center pt-1">
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-medium">Active</div>
                  <div className="text-sm font-bold text-slate-800 dark:text-gray-250">{activeCount}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-medium">In Review</div>
                  <div className="text-sm font-bold text-purple-650 dark:text-purple-400">{reviewCount}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg p-2">
                  <div className="text-[10px] text-slate-400 font-medium">Overdue</div>
                  <div className={cn('text-sm font-bold', overdueCount > 0 ? 'text-red-650' : 'text-slate-800 dark:text-gray-250')}>{overdueCount}</div>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-700 text-sm">Completion Progress</h3>
                  <span className="text-sm font-bold text-slate-800">{progress}%</span>
                </div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
              <p className="text-xs text-slate-400 mt-2">
                {totalTickets === 0
                  ? "No linked tickets yet."
                  : `${project.ticketStats?.done ?? project.tickets?.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length ?? 0} of ${project.ticketStats?.total ?? project.tickets?.length ?? 0} tickets resolved`
                }
              </p>
            </div>
          </div>

          {/* Tickets */}
          <div className="bg-white rounded-xl border border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                <Ticket size={15} /> Tickets ({project.tickets?.length || 0})
              </h3>
              <Link href={`/tickets/new?projectId=${project.id}&projectName=${encodeURIComponent(project.name)}&from=${encodeURIComponent(`/projects/${project.id}`)}`} className="text-xs text-blue-600 hover:underline">Add ticket</Link>
            </div>
            <div>
              {project.tickets?.length > 0 ? (
                project.tickets.map((t: any) => (
                  <TicketRow
                    key={t.id}
                    ticket={t}
                    href={`/tickets/${t.id}?from=project&projectId=${project.id}&projectName=${encodeURIComponent(project.name)}`}
                  />
                ))
              ) : (
                <div className="p-8 text-center text-slate-400 text-sm">No tickets in this project</div>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Team */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-700 text-sm flex items-center gap-2">
                <Users size={14} /> Team ({project.members?.length || 0})
              </h3>
              {canEdit && (
                <button onClick={() => setShowAddMember(true)} className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                  <UserPlus size={13} /> Add
                </button>
              )}
            </div>

            {showAddMember && (
              <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-100">
                <select className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded mb-2" value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}>
                  <option value="">Select User...</option>
                  {usersList.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded mb-2" value={memberRole} onChange={e => setMemberRole(e.target.value)}>
                  <option value="MEMBER">Member</option>
                  <option value="OWNER">Owner</option>
                  <option value="OBSERVER">Observer</option>
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => selectedUserId && addMemberMutation.mutate({ userId: selectedUserId, role: memberRole })}
                    disabled={!selectedUserId || addMemberMutation.isPending}
                    className="text-[11px] font-semibold bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button onClick={() => setShowAddMember(false)} className="text-[11px] text-slate-600 hover:bg-slate-200 px-3 py-1 rounded">Cancel</button>
                </div>
              </div>
            )}

            <div className="space-y-2.5">
              {project.members?.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between group">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs font-semibold">{getInitials(m.user?.name || '')}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{m.user?.name}</p>
                      <p className="text-xs text-slate-400">{m.user?.role?.name} · {m.role}</p>
                    </div>
                  </div>
                  {canEdit && (
                    <button
                      onClick={() => { if(confirm('Remove this member?')) removeMemberMutation.mutate(m.userId); }}
                      disabled={removeMemberMutation.isPending}
                      className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <h3 className="font-semibold text-slate-700 text-sm">Details</h3>
            {project.department && (
              <div>
                <p className="text-xs text-slate-400">Department</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{project.department.name}</p>
              </div>
            )}
            {project.startDate && (
              <div>
                <p className="text-xs text-slate-400">Start Date</p>
                <p className="text-sm font-medium text-slate-700 mt-0.5">{formatDate(project.startDate)}</p>
              </div>
            )}
            {project.endDate && (
              <div>
                <p className="text-xs text-slate-400">End Date</p>
                <p className={cn('text-sm font-medium mt-0.5', new Date(project.endDate) < new Date() ? 'text-red-650' : 'text-slate-700')}>
                  {formatDate(project.endDate)}
                </p>
              </div>
            )}
          </div>

          {/* Project Activity Feed */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="font-semibold text-slate-700 text-sm mb-3 flex items-center gap-2">
              <Activity size={14} /> Project Activity
            </h3>
            {isEventsError ? (
              <div className="text-center py-4">
                <p className="text-xs text-red-500 mb-2 font-medium">Project activity unavailable</p>
                <button onClick={() => refetchEvents()} className="text-[11px] text-blue-600 hover:underline font-semibold bg-transparent border-none cursor-pointer">Retry</button>
              </div>
            ) : projectEvents.length > 0 ? (
              <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
                {projectEvents.slice(0, 15).map((ev: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs">
                    <div className="w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: ev.actor?.avatar ?? 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700 }}>
                      {(ev.actor?.name ?? '?').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-slate-600 dark:text-gray-300 leading-relaxed">
                        <strong className="text-slate-800 dark:text-gray-100 font-semibold">{ev.actor?.name ?? 'Someone'}</strong>{' '}
                        {ev.description ?? ev.action.toLowerCase().replace(/_/g, ' ')}
                        {ev.entityType === 'Ticket' && ev.metadata?.ticketId && (
                          <Link href={`/tickets/${ev.entityId}`} className="ml-1 text-blue-600 dark:text-blue-400 hover:underline font-mono">
                            [{ev.metadata.ticketId}]
                          </Link>
                        )}
                      </p>
                      <span className="text-[10px] text-slate-450 dark:text-gray-500">{formatRelativeTime(ev.timestamp)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-4">No recent activity on this project</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
