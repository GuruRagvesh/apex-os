'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '@/lib/api';
import { departmentsApi } from '../api';
import { useAuthStore } from '@apex/core-identity';
import { Plus, Users, Ticket, FolderKanban, MoreVertical, Trash2, ChevronRight, UserCircle2, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

export default function DepartmentsScreen() {
  const router = useRouter();
  const { user, hasHydrated } = useAuthStore();
  const qc = useQueryClient();

  const isAdmin = ADMIN_ROLES.includes(user?.role?.name ?? '');

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', color: '#6366f1' });
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const { data: departments, isLoading } = useQuery({
    queryKey: ['departments'],
    queryFn: () => departmentsApi.getAll() as Promise<any[]>,
    enabled: hasHydrated && isAdmin,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any>,
    enabled: hasHydrated && isAdmin && showNew,
  });
  const userList: any[] = usersData?.users ?? (Array.isArray(usersData) ? usersData : []);

  const createMutation = useMutation({
    mutationFn: (data: any) => departmentsApi.create(data),
    onSuccess: () => {
      toast.success('Department created!');
      qc.invalidateQueries({ queryKey: ['departments'] });
      setShowNew(false);
      setForm({ name: '', description: '', color: '#6366f1' });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create department'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => departmentsApi.remove(id),
    onSuccess: () => {
      toast.success('Department deleted');
      qc.invalidateQueries({ queryKey: ['departments'] });
      setDeleteTarget(null);
    },
    onError: (err: any) =>
      toast.error(err?.message || err?.error || 'Cannot delete department'),
  });

  if (!hasHydrated) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto apex-card p-8 text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
          <ShieldAlert size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Departments is admin-only</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Use Team for your role-specific department and roster view.
          </p>
        </div>
        <Link href="/dashboard" className="apex-btn apex-btn-primary inline-flex justify-center">
          Back to Dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Departments</h2>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {Array.isArray(departments) ? departments.length : 0} departments
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowNew(true)} className="apex-btn-new-ticket">
            <Plus size={16} /> New Department
          </button>
        )}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.isArray(departments) &&
            departments.map((d: any) => (
              <div
                key={d.id}
                className="apex-card-clickable p-5 group relative"
                onClick={() => router.push(`/departments/${d.id}`)}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: (d.color || '#6366f1') + '20' }}
                    >
                      <div className="w-5 h-5 rounded-full" style={{ backgroundColor: d.color || '#6366f1' }} />
                    </div>
                    <div>
                      <h3 className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.name}</h3>
                      {d.description && (
                        <p className="text-xs mt-0.5 line-clamp-1" style={{ color: 'var(--text-secondary)' }}>{d.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions menu */}
                  <div className="flex items-center gap-1" ref={menuOpen === d.id ? menuRef : undefined}>
                    <ChevronRight size={16} style={{ color: 'var(--text-tertiary)' }} />
                    {isAdmin && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === d.id ? null : d.id); }}
                        className="p-1 rounded-md transition-colors"
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)')}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <MoreVertical size={15} style={{ color: 'var(--text-tertiary)' }} />
                      </button>
                    )}
                    {menuOpen === d.id && (
                      <div
                        className="absolute top-12 right-4 rounded-lg shadow-lg z-10 min-w-[140px] p-1"
                        style={{
                          backgroundColor: 'var(--surface-elevated)',
                          border: '1px solid var(--border-primary)',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                      >
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ id: d.id, name: d.name }); setMenuOpen(null); }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg transition-colors"
                          style={{ color: 'var(--color-danger)' }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Team lead */}
                {d.teamLead && (
                  <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    <UserCircle2 size={13} style={{ color: 'var(--text-tertiary)' }} />
                    <span>Lead: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.teamLead.name}</span></span>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { icon: Users, val: d._count?.users || 0, label: 'Members' },
                    { icon: Ticket, val: d.activeTickets ?? d._count?.tickets ?? 0, label: 'Active' },
                    { icon: FolderKanban, val: d._count?.projects || 0, label: 'Projects' },
                  ].map(({ icon: Icon, val, label }) => (
                    <div key={label} className="rounded-lg p-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                      <div className="flex items-center justify-center mb-1">
                        <Icon size={13} style={{ color: 'var(--text-tertiary)' }} />
                      </div>
                      <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{val}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{label}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* New Department Modal */}
      {showNew && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>New Department</h3>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="apex-input" placeholder="e.g., Finance" autoFocus />
              </div>
              <div>
                <label className="apex-label">Description</label>
                <input type="text" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="apex-input" placeholder="Brief description" />
              </div>
              <div>
                <label className="apex-label">Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} className="w-10 h-10 rounded-lg cursor-pointer" style={{ border: '1px solid var(--border-primary)' }} />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{form.color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => form.name && createMutation.mutate(form)} disabled={createMutation.isPending || !form.name.trim()} className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50">
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button onClick={() => setShowNew(false)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-sm p-6 modal-enter">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'var(--color-danger-bg)' }}>
                <Trash2 size={18} style={{ color: 'var(--color-danger)' }} />
              </div>
              <div>
                <h3 className="font-bold" style={{ color: 'var(--text-primary)' }}>Delete Department</h3>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm mb-5 rounded-lg p-3" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-tertiary)' }}>
              Delete <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{deleteTarget.name}</span>?
              Members will be unassigned from this department.
            </p>
            <div className="flex gap-3">
              <button onClick={() => deleteMutation.mutate(deleteTarget.id)} disabled={deleteMutation.isPending} className="apex-btn apex-btn-danger flex-1 justify-center py-2.5 disabled:opacity-50">
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
              <button onClick={() => setDeleteTarget(null)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
