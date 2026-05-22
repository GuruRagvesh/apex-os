'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { projectsApi, departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, PROJECT_STATUS_COLORS, PRIORITY_COLORS, formatDate, getInitials } from '@/lib/utils';
import { Plus, FolderKanban, Users, Ticket, Calendar } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import Link from 'next/link';
import toast from 'react-hot-toast';

function ProjectCard({ project }: { project: any }) {
  const statusColor = PROJECT_STATUS_COLORS[project.status] || 'bg-gray-100 text-gray-700';
  const members = project.members?.slice(0, 4) || [];

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
          <span className={cn('text-xs px-2 py-0.5 rounded font-medium', PRIORITY_COLORS[project.priority])}>{project.priority}</span>
        </div>
      </div>

      {project.description && (
        <p className="text-sm mb-4 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{project.description}</p>
      )}

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

  const { data, isLoading } = useQuery({
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

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Projects</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{projectList.length} projects</p>
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
                onClick={() => form.name && createMutation.mutate({ ...form, departmentId: form.departmentId || undefined, endDate: form.endDate ? new Date(form.endDate).toISOString() : undefined })}
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
      ) : projectList.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {projectList.map((p: any) => <ProjectCard key={p.id} project={p} />)}
        </div>
      ) : (
        <div className="apex-card">
          <EmptyState
            icon="📁"
            title="No projects yet"
            description="Create a project to group related tickets and track progress"
            actionLabel={canCreate ? "New Project" : undefined}
            onAction={canCreate ? () => setShowNew(true) : undefined}
          />
        </div>
      )}
    </div>
  );
}
