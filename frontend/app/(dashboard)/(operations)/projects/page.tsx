'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, PROJECT_STATUS_COLORS, PRIORITY_COLORS, formatDate, getInitials } from '@/lib/utils';
import { Plus, FolderKanban, Users, Ticket, Calendar } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import toast from 'react-hot-toast';

function ProjectCard({ project }: { project: any }) {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-700';
  const members = project.members?.slice(0, 4) || [];
  const tickets = project.tickets || [];

  const totalTickets = tickets.length;
  const doneTickets = tickets.filter((t: any) => t.status === 'DONE' || t.status === 'CLOSED').length;
  const progress = totalTickets > 0 ? Math.round((doneTickets / totalTickets) * 100) : 0;

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
    healthColor = "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/20 dark:text-yellow-400 dark:border-yellow-800";
  } else if (totalTickets === 0) {
    healthLabel = "No Work";
    healthColor = "bg-slate-50 text-slate-650 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-800";
  } else if (progress === 100) {
    healthLabel = "Completed";
    healthColor = "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/20 dark:text-blue-400 dark:border-blue-800";
  }

  return (
    <Link
      href={`/projects/${project.id}`}
      className="apex-card-clickable block p-5"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <span className="text-xs font-mono font-medium" style={{ color: 'var(--text-tertiary)' }}>{project.projectId}</span>
          <h3 className="font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{project.name}</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', statusColor)}>{project.status}</span>
          <div className="flex gap-1 items-center">
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium border', healthColor)}>{healthLabel}</span>
            <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium', PRIORITY_COLORS[project.priority])}>{project.priority}</span>
          </div>
        </div>
      </div>

      {project.description && (
        <p className="text-sm mb-4 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{project.description}</p>
      )}

      {/* Ticket Status Breakdown */}
      <div className="flex items-center gap-2 mb-4 mt-2 flex-wrap">
        <span className="text-xs px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-350 font-medium">
          {activeCount} active
        </span>
        {reviewCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/20 text-purple-755 dark:text-purple-300 font-semibold animate-pulse">
            {reviewCount} review
          </span>
        )}
        {overdueCount > 0 && (
          <span className="text-xs px-2 py-0.5 rounded bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400 font-bold">
            ⚠️ {overdueCount} overdue
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="space-y-1 mb-4">
        <div className="flex justify-between text-xs font-semibold text-slate-500">
          <span>Completion Progress</span>
          <span>{progress}%</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
          <div className="bg-blue-600 h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <div className="flex items-center gap-3">
          {project.department && (
            <span className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: project.department.color }} />
              {project.department.name}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Ticket size={12} />
            {project._count?.tickets || 0} tickets
          </span>
        </div>
        <div className="flex -space-x-1.5">
          {members.map((m: any) => (
            <div
              key={m.id}
              className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)', borderColor: 'var(--surface-card)' }}
              title={m.user?.name}
            >
              <span className="text-white text-[9px] font-bold">{getInitials(m.user?.name || '')}</span>
            </div>
          ))}
          {(project._count?.members || 0) > 4 && (
            <div
              className="w-6 h-6 rounded-full border-2 flex items-center justify-center"
              style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--surface-card)' }}
            >
              <span className="text-[9px]" style={{ color: 'var(--text-secondary)' }}>+{project._count.members - 4}</span>
            </div>
          )}
        </div>
      </div>

      {project.endDate && (
        <div
          className="mt-3 pt-3 flex items-center gap-1 text-xs"
          style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-tertiary)' }}
        >
          <Calendar size={11} />
          Due {formatDate(project.endDate)}
        </div>
      )}
    </Link>
  );
}

export default function ProjectsPage() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const roleName = (user?.role as any)?.name ?? user?.role ?? '';
  const canCreate = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'].includes(roleName);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', priority: 'MEDIUM', departmentId: '', endDate: '' });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.getAll() as Promise<any>,
  });

  const { data: departments } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => projectsApi.create(data),
    onSuccess: (p: any) => {
      toast.success(`Project ${p.projectId} created!`);
      qc.invalidateQueries({ queryKey: ['projects'] });
      setShowNew(false);
      setForm({ name: '', description: '', priority: 'MEDIUM', departmentId: '', endDate: '' });
    },
    onError: () => toast.error('Failed to create project'),
  });

  const projects = data?.projects || Array.isArray(data) ? (Array.isArray(data) ? data : []) : [];
  const projectList = Array.isArray(data) ? data : (data?.projects || []);

  const searchParams = useSearchParams();
  const statusFilter = searchParams.get('status');

  const filteredProjects = useMemo(() => {
    if (!statusFilter) return projectList;
    return projectList.filter((p: any) => p.status === statusFilter);
  }, [projectList, statusFilter]);

  const scopeText =
    roleName === 'SUPER_ADMIN' ? 'Showing company-wide projects' :
    roleName === 'ADMIN' ? 'Showing company-wide projects' :
    roleName === 'MANAGER' ? 'Showing managed department projects' :
    roleName === 'TEAM_LEAD' ? 'Showing your team projects' :
    'Showing your assigned projects';

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Projects</h2>
            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-650 px-2 py-0.5 rounded-full dark:bg-slate-800 dark:text-slate-400">
              {scopeText}
            </span>
          </div>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            {filteredProjects.length} projects {statusFilter ? `(${statusFilter.toLowerCase()})` : 'total'}
          </p>
        </div>
        {canCreate && (
          <button onClick={() => setShowNew(true)} className="apex-btn-new-ticket">
            <Plus size={16} />New Project
          </button>
        )}
      </div>

      {/* New Project Modal */}
      {showNew && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-lg p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>New Project</h3>
            <div className="space-y-4">
              <div>
                <label className="apex-label">Project Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="apex-input" placeholder="e.g., Office Network Upgrade" />
              </div>
              <div>
                <label className="apex-label">Description</label>
                <textarea value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} className="apex-textarea" rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="apex-label">Priority</label>
                  <select value={form.priority} onChange={(e) => setForm(f => ({ ...f, priority: e.target.value }))} className="apex-select w-full">
                    {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="apex-label">Department</label>
                  <select value={form.departmentId} onChange={(e) => setForm(f => ({ ...f, departmentId: e.target.value }))} className="apex-select w-full">
                    <option value="">Select...</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="apex-label">End Date</label>
                <input type="date" value={form.endDate} onChange={(e) => setForm(f => ({ ...f, endDate: e.target.value }))} className="apex-input" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name && createMutation.mutate({ ...form, departmentId: form.departmentId || null, endDate: form.endDate ? new Date(form.endDate).toISOString() : null })}
                disabled={createMutation.isPending || !form.name}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Project'}
              </button>
              <button onClick={() => setShowNew(false)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center h-64 gap-3 apex-card">
          <p className="text-sm" style={{ color: 'var(--color-danger)' }}>Failed to load projects.</p>
          <button onClick={() => refetch()} className="apex-btn apex-btn-secondary text-xs">Retry</button>
        </div>
      ) : filteredProjects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredProjects.map((p: any) => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <div className="apex-card">
          <EmptyState
            icon="📁"
            title={statusFilter ? `No ${statusFilter.toLowerCase()} projects` : "No projects yet"}
            description={statusFilter ? `No projects found with status "${statusFilter}".` : "Create a project to group related tickets and track progress"}
            actionLabel={canCreate && !statusFilter ? "New Project" : undefined}
            onAction={canCreate && !statusFilter ? () => setShowNew(true) : undefined}
          />
        </div>
      )}
    </div>
  );
}
