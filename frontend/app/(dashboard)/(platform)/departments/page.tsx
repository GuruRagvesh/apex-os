'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { departmentsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Plus, Users, Ticket, FolderKanban, MoreVertical, Trash2, ChevronRight, UserCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'];

export default function DepartmentsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
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
  });

  const { data: usersData } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll() as Promise<any>,
    enabled: showNew,
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

  const inputCls =
    'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white';

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Departments</h2>
          <p className="text-sm text-slate-500">
            {Array.isArray(departments) ? departments.length : 0} departments
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New Department
          </button>
        )}
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.isArray(departments) &&
            departments.map((d: any) => (
              <div
                key={d.id}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-all cursor-pointer group relative"
                onClick={() => router.push(`/departments/${d.id}`)}
              >
                {/* Card header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: (d.color || '#6366f1') + '20' }}
                    >
                      <div
                        className="w-5 h-5 rounded-full"
                        style={{ backgroundColor: d.color || '#6366f1' }}
                      />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{d.name}</h3>
                      {d.description && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{d.description}</p>
                      )}
                    </div>
                  </div>

                  {/* Actions menu */}
                  <div className="flex items-center gap-1" ref={menuOpen === d.id ? menuRef : undefined}>
                    <ChevronRight
                      size={16}
                      className="text-slate-300 group-hover:text-slate-500 transition-colors"
                    />
                    {isAdmin && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(menuOpen === d.id ? null : d.id);
                        }}
                        className="p-1 hover:bg-slate-100 rounded-md transition-colors"
                      >
                        <MoreVertical size={15} className="text-slate-400" />
                      </button>
                    )}
                    {menuOpen === d.id && (
                      <div className="absolute top-12 right-4 bg-white border border-slate-200 rounded-lg shadow-lg z-10 min-w-[140px]">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteTarget({ id: d.id, name: d.name });
                            setMenuOpen(null);
                          }}
                          className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={14} />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Team lead */}
                {d.teamLead && (
                  <div className="flex items-center gap-2 mb-3 text-xs text-slate-500">
                    <UserCircle2 size={13} className="text-slate-400" />
                    <span>Lead: <span className="font-medium text-slate-700">{d.teamLead.name}</span></span>
                  </div>
                )}

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center justify-center mb-1">
                      <Users size={13} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-800">{d._count?.users || 0}</p>
                    <p className="text-xs text-slate-400">Members</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center justify-center mb-1">
                      <Ticket size={13} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-800">
                      {d.activeTickets ?? d._count?.tickets ?? 0}
                    </p>
                    <p className="text-xs text-slate-400">Active</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-2">
                    <div className="flex items-center justify-center mb-1">
                      <FolderKanban size={13} className="text-slate-400" />
                    </div>
                    <p className="text-sm font-bold text-slate-800">{d._count?.projects || 0}</p>
                    <p className="text-xs text-slate-400">Projects</p>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* New Department Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 text-lg mb-5">New Department</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Name *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={inputCls}
                  placeholder="e.g., Finance"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  className={inputCls}
                  placeholder="Brief description"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Color</label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="w-10 h-10 rounded-lg border border-slate-200 cursor-pointer"
                  />
                  <span className="text-sm text-slate-500">{form.color}</span>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name && createMutation.mutate(form)}
                disabled={createMutation.isPending || !form.name.trim()}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 text-sm"
              >
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </button>
              <button
                onClick={() => setShowNew(false)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Delete Department</h3>
                <p className="text-sm text-slate-500">This action cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-slate-600 mb-5 bg-slate-50 rounded-lg p-3">
              Delete <span className="font-semibold text-slate-800">{deleteTarget.name}</span>?
              Members will be unassigned from this department.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 rounded-lg disabled:opacity-50 text-sm"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 border border-slate-200 text-slate-600 py-2.5 rounded-lg hover:bg-slate-50 text-sm"
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
