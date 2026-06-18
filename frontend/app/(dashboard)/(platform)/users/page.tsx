'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { usersApi, rolesApi, departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, getInitials } from '@/lib/utils';
import { Plus, Search, UserCheck, UserX, Edit2, ExternalLink, ShieldAlert, Download, Loader2, Trash2 } from 'lucide-react';
import Link from 'next/link';
import toast from 'react-hot-toast';

// Light-mode classes — dark themes handled via globals.css CSS-variable overrides
const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-orange-100 text-orange-700',
  TEAM_LEAD: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-green-100 text-green-700',
  INTERN: 'bg-slate-100 text-slate-600',
};

export default function UsersPage() {
  const { user: me, hasHydrated } = useAuthStore();
  const qc = useQueryClient();
  const router = useRouter();
  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(me?.role?.name ?? '');
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '', departmentId: '' });
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', roleId: '', departmentId: '', isActive: true });
  const [deactivateTarget, setDeactivateTarget] = useState<any | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<any | null>(null);
  const [permanentDeleteBlockers, setPermanentDeleteBlockers] = useState<Record<string, number> | null>(null);

  const { data: usersResponse, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => usersApi.getAll(search ? { search } : {}) as Promise<any>,
    enabled: hasHydrated && isAdmin,
  });
  const userList: any[] = usersResponse?.users ?? (Array.isArray(usersResponse) ? usersResponse : []);

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.getAll() as Promise<any[]>, enabled: hasHydrated && isAdmin });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any[]>, enabled: hasHydrated && isAdmin });

  const createMutation = useMutation({
    mutationFn: (data: any) => usersApi.create(data),
    onSuccess: (u: any) => {
      toast.success(`User ${u.name} created!`);
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowNew(false);
      setForm({ name: '', email: '', password: '', roleId: '', departmentId: '' });
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to create user'),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => usersApi.update(id, { isActive }),
    onSuccess: (_, vars) => {
      if (vars.isActive) toast.success('User activated');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Failed to activate user'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => {
      toast.success('User deactivated');
      qc.invalidateQueries({ queryKey: ['users'] });
      setDeactivateTarget(null);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to deactivate user'),
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.permanentDelete(id),
    onSuccess: () => {
      toast.success('User permanently deleted');
      qc.invalidateQueries({ queryKey: ['users'] });
      setPermanentDeleteTarget(null);
    },
    onError: (err: any) => {
      if (err?.blockers) {
        setPermanentDeleteTarget(null);
        setPermanentDeleteBlockers(err.blockers);
      } else {
        toast.error(err?.message || 'Permanent delete failed');
        setPermanentDeleteTarget(null);
      }
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => {
      toast.success('User updated!');
      qc.invalidateQueries({ queryKey: ['users'] });
      setEditUser(null);
    },
    onError: (err: any) => toast.error(err?.message || 'Failed to update user'),
  });

  // Client-side filtering
  const filteredUsers = userList.filter((u: any) => {
    const matchSearch = !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase());
    const matchDept = !deptFilter || u.departmentId === deptFilter;
    const matchRole = !roleFilter || (u.role?.name ?? u.role) === roleFilter;
    const matchStatus = !statusFilter || (statusFilter === 'active' ? u.isActive !== false : u.isActive === false);
    return matchSearch && matchDept && matchRole && matchStatus;
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
          <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Users & Roles is admin-only</h1>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Use Team, Profile, or Settings for your own role-specific people and account information.
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Users</h2>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{filteredUsers.length} of {userList.length} team members</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowNew(true)} className="apex-btn-new-ticket">
            <Plus size={16} />Add User
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-tertiary)' }} />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="apex-input pl-9 rounded-xl"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="apex-select">
          <option value="">All Departments</option>
          {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="apex-select">
          <option value="">All Roles</option>
          {['INTERN','EMPLOYEE','TEAM_LEAD','MANAGER','ADMIN','SUPER_ADMIN'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="apex-select">
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {(deptFilter || roleFilter || statusFilter) && (
          <button
            onClick={() => { setDeptFilter(''); setRoleFilter(''); setStatusFilter(''); }}
            className="text-xs font-medium"
            style={{ color: 'var(--color-danger)' }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Users Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--accent)' }} />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((u: any) => (
            <div
              key={u.id}
              className={cn('apex-card p-5 flex flex-col gap-3 transition-all hover:shadow-md rounded-2xl', !u.isActive && 'opacity-60')}
              style={{'--hover-border': 'var(--accent-border)'} as any}
            >
              <div className="flex items-start gap-3">
                {u.photoUrl ? (
                  <img src={u.photoUrl} alt={u.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
                    style={{ backgroundColor: u.avatar || '#6366f1' }}
                  >
                    {getInitials(u.name)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-primary)' }}>{u.name}</p>
                    <span
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: u.isActive !== false ? 'var(--color-success)' : 'var(--color-danger)' }}
                      title={u.isActive !== false ? 'Active' : 'Inactive'}
                    />
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{u.email}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', roleBadge[u.role?.name] || 'bg-gray-100 text-gray-700')}>
                      {u.role?.name}
                    </span>
                    {u.department && (
                      <span
                        className="text-xs px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                      >
                        {u.department.name}
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && u.id !== me?.id && (
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => {
                        setEditUser(u);
                        setEditForm({ name: u.name, roleId: u.role?.id ?? '', departmentId: u.departmentId ?? '', isActive: u.isActive });
                      }}
                      className="p-1.5 rounded-lg transition-colors"
                      style={{ color: 'var(--text-tertiary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.backgroundColor = 'var(--accent-subtle)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="Edit user"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={async () => {
                        setDownloadingId(u.id);
                        const toastId = `backup-${u.id}`;
                        toast.loading('Downloading backup...', { id: toastId });
                        try {
                          await usersApi.downloadBackup(u.id, u.name);
                          toast.success('Backup downloaded', { id: toastId });
                        } catch {
                          toast.error('Backup download failed', { id: toastId });
                        } finally {
                          setDownloadingId(null);
                        }
                      }}
                      disabled={downloadingId === u.id}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ color: 'var(--text-tertiary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent)'; e.currentTarget.style.backgroundColor = 'var(--accent-subtle)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="Download user backup (.xlsx)"
                    >
                      {downloadingId === u.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    </button>
                    {!u.isActive && (
                      <button
                        onClick={() => setPermanentDeleteTarget(u)}
                        disabled={permanentDeleteMutation.isPending}
                        className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                        style={{ color: 'var(--text-tertiary)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-danger)'; e.currentTarget.style.backgroundColor = 'var(--color-danger-bg)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                        title="Permanently delete user"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                    <button
                      onClick={() => u.isActive ? setDeactivateTarget(u) : toggleActive.mutate({ id: u.id, isActive: true })}
                      disabled={deactivateMutation.isPending || toggleActive.isPending}
                      className="p-1.5 rounded-lg transition-colors disabled:opacity-40"
                      style={{ color: 'var(--text-tertiary)' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = u.isActive ? 'var(--color-danger)' : 'var(--color-success)';
                        e.currentTarget.style.backgroundColor = u.isActive ? 'var(--color-danger-bg)' : 'var(--color-success-bg)';
                      }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title={u.isActive ? 'Deactivate user' : 'Activate user'}
                    >
                      {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                  </div>
                )}
              </div>

              {/* View Profile button */}
              <button
                onClick={() => router.push(`/users/${u.id}/profile`)}
                className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium rounded-xl transition-colors"
                style={{ color: 'var(--accent)', border: '1px solid var(--accent-border)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-subtle)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <ExternalLink size={12} />
                View Profile
              </button>
            </div>
          ))}
          {filteredUsers.length === 0 && !isLoading && (
            <div className="col-span-3 apex-empty">
              <p className="apex-empty-title">No users match the current filters</p>
              <p className="apex-empty-desc">Try adjusting your search or filters.</p>
            </div>
          )}
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>Edit User</h3>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Full Name</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className="apex-input" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="apex-label">Role</label>
                  <select value={editForm.roleId} onChange={(e) => setEditForm(f => ({ ...f, roleId: e.target.value }))} className="apex-select w-full">
                    <option value="">Select role</option>
                    {Array.isArray(roles) && roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="apex-label">Department</label>
                  <select value={editForm.departmentId} onChange={(e) => setEditForm(f => ({ ...f, departmentId: e.target.value }))} className="apex-select w-full">
                    <option value="">None</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => editForm.name && editMutation.mutate({ id: editUser.id, data: { name: editForm.name, roleId: editForm.roleId || null, departmentId: editForm.departmentId || null } })}
                disabled={editMutation.isPending || !editForm.name}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {editMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditUser(null)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Deactivate Confirmation Modal */}
      {deactivateTarget && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Deactivate user?</h3>
            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
              <strong>{deactivateTarget.name}</strong> will lose login access and be hidden from active workflows.
            </p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Historical tickets, comments, work sessions, leave records, and audit logs will be preserved.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deactivateMutation.mutate(deactivateTarget.id)}
                disabled={deactivateMutation.isPending}
                className="apex-btn flex-1 justify-center py-2.5 font-medium disabled:opacity-50 text-white"
                style={{ backgroundColor: 'var(--color-danger)' }}
              >
                {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}
              </button>
              <button
                onClick={() => setDeactivateTarget(null)}
                className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Confirmation Modal */}
      {permanentDeleteTarget && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Permanently delete user?</h3>
            <p className="text-sm mb-1" style={{ color: 'var(--text-secondary)' }}>
              <strong>{permanentDeleteTarget.name}</strong> will be removed from the system forever. This cannot be undone.
            </p>
            <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
              Download backup first if you need a record of their history.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => permanentDeleteMutation.mutate(permanentDeleteTarget.id)}
                disabled={permanentDeleteMutation.isPending}
                className="apex-btn flex-1 justify-center py-2.5 font-medium disabled:opacity-50 text-white"
                style={{ backgroundColor: 'var(--color-danger)' }}
              >
                {permanentDeleteMutation.isPending ? 'Deleting...' : 'Permanently Delete'}
              </button>
              <button onClick={() => setPermanentDeleteTarget(null)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanent Delete Blocker Modal */}
      {permanentDeleteBlockers && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Cannot delete — user has linked records</h3>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              This user has operational history that prevents permanent deletion:
            </p>
            <ul className="mb-5 space-y-1.5">
              {Object.entries(permanentDeleteBlockers).map(([key, count]) => (
                <li key={key} className="flex justify-between text-sm px-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{key}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => setPermanentDeleteBlockers(null)}
              className="apex-btn apex-btn-secondary w-full justify-center py-2.5"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* New User Modal */}
      {showNew && (
        <div className="apex-backdrop flex items-center justify-center p-4">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-5" style={{ color: 'var(--text-primary)' }}>Add New User</h3>
            <div className="space-y-3">
              <div>
                <label className="apex-label">Full Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className="apex-input" placeholder="Rajesh Kumar" />
              </div>
              <div>
                <label className="apex-label">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} className="apex-input" placeholder="rajesh@technoedge.com" />
              </div>
              <div>
                <label className="apex-label">Password *</label>
                <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} className="apex-input" placeholder="Min 6 characters" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="apex-label">Role *</label>
                  <select value={form.roleId} onChange={(e) => setForm(f => ({ ...f, roleId: e.target.value }))} className="apex-select w-full">
                    <option value="">Select role</option>
                    {Array.isArray(roles) && roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="apex-label">Department</label>
                  <select value={form.departmentId} onChange={(e) => setForm(f => ({ ...f, departmentId: e.target.value }))} className="apex-select w-full">
                    <option value="">Select</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name && form.email && form.password && form.roleId && createMutation.mutate({ ...form, departmentId: form.departmentId || null })}
                disabled={createMutation.isPending || !form.name || !form.email || !form.password || !form.roleId}
                className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating...' : 'Create User'}
              </button>
              <button onClick={() => setShowNew(false)} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
