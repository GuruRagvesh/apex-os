'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { usersApi, rolesApi, departmentsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn, getInitials } from '@/lib/utils';
import { Plus, Search, UserCheck, UserX, Edit2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

const roleBadgeDark: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-900 text-purple-300',
  ADMIN: 'bg-red-900 text-red-300',
  MANAGER: 'bg-blue-900 text-blue-300',
  TEAM_LEAD: 'bg-cyan-900 text-cyan-300',
  EMPLOYEE: 'bg-green-900 text-green-300',
  INTERN: 'bg-yellow-900 text-yellow-300',
};

// Also keep light-mode badges for backward compat
const roleBadge: Record<string, string> = {
  SUPER_ADMIN: 'bg-purple-100 text-purple-700',
  ADMIN: 'bg-red-100 text-red-700',
  MANAGER: 'bg-orange-100 text-orange-700',
  TEAM_LEAD: 'bg-blue-100 text-blue-700',
  EMPLOYEE: 'bg-green-100 text-green-700',
  INTERN: 'bg-slate-100 text-slate-600',
};

export default function UsersPage() {
  const { user: me } = useAuthStore();
  const qc = useQueryClient();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '', departmentId: '' });
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', roleId: '', departmentId: '', isActive: true });

  const { data: usersResponse, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => usersApi.getAll(search ? { search } : {}) as Promise<any>,
  });
  const userList: any[] = usersResponse?.users ?? (Array.isArray(usersResponse) ? usersResponse : []);

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: () => rolesApi.getAll() as Promise<any[]> });
  const { data: departments } = useQuery({ queryKey: ['departments'], queryFn: () => departmentsApi.getAll() as Promise<any[]> });

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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); },
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

  const isAdmin = ['ADMIN', 'SUPER_ADMIN'].includes(me?.role?.name ?? '');
  const inputCls = 'w-full px-3 py-2 text-sm border border-slate-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500';

  // Client-side filtering
  const filteredUsers = userList.filter((u: any) => {
    const matchSearch = !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase());
    const matchDept = !deptFilter || u.departmentId === deptFilter;
    const matchRole = !roleFilter || (u.role?.name ?? u.role) === roleFilter;
    const matchStatus = !statusFilter || (statusFilter === 'active' ? u.isActive !== false : u.isActive === false);
    return matchSearch && matchDept && matchRole && matchStatus;
  });

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">Users</h2>
          <p className="text-sm text-slate-500 dark:text-gray-400 mt-0.5">{filteredUsers.length} of {userList.length} team members</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowNew(true)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors">
            <Plus size={16} />Add User
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-gray-500" />
        <input
          type="text"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-slate-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-900 text-slate-900 dark:text-gray-100 placeholder:text-slate-400 dark:placeholder:text-gray-500"
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={deptFilter}
          onChange={(e) => setDeptFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Departments</option>
          {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Roles</option>
          {['INTERN','EMPLOYEE','TEAM_LEAD','MANAGER','ADMIN','SUPER_ADMIN'].map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {(deptFilter || roleFilter || statusFilter) && (
          <button
            onClick={() => { setDeptFilter(''); setRoleFilter(''); setStatusFilter(''); }}
            className="text-xs text-blue-500 hover:text-blue-400"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Users Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((u: any) => (
            <div
              key={u.id}
              className={cn(
                'bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 p-5 flex flex-col gap-3 transition-all hover:shadow-md hover:border-blue-400 dark:hover:border-blue-600',
                !u.isActive && 'opacity-60'
              )}
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
                    <p className="font-semibold text-slate-800 dark:text-gray-100 text-sm truncate">{u.name}</p>
                    {/* Status dot */}
                    <span className={cn('w-2 h-2 rounded-full flex-shrink-0', u.isActive !== false ? 'bg-green-500' : 'bg-red-500')} title={u.isActive !== false ? 'Active' : 'Inactive'} />
                  </div>
                  <p className="text-xs text-slate-500 dark:text-gray-400 truncate">{u.email}</p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', roleBadge[u.role?.name] || 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300')}>
                      {u.role?.name}
                    </span>
                    {u.department && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
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
                      className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                      title="Edit user"
                    >
                      <Edit2 size={14} />
                    </button>
                    <button
                      onClick={() => toggleActive.mutate({ id: u.id, isActive: !u.isActive })}
                      className={cn('p-1.5 rounded-lg transition-colors', u.isActive ? 'text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30' : 'text-slate-400 hover:text-green-500 hover:bg-green-50 dark:hover:bg-green-900/30')}
                      title={u.isActive ? 'Deactivate' : 'Activate'}
                    >
                      {u.isActive ? <UserX size={14} /> : <UserCheck size={14} />}
                    </button>
                  </div>
                )}
              </div>

              {/* View Profile button */}
              <button
                onClick={() => router.push(`/users/${u.id}/profile`)}
                className="flex items-center justify-center gap-1.5 w-full py-2 text-xs font-medium text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <ExternalLink size={12} />
                View Profile
              </button>
            </div>
          ))}
          {filteredUsers.length === 0 && !isLoading && (
            <div className="col-span-3 text-center text-slate-400 py-12">No users match the current filters.</div>
          )}
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 dark:text-white text-lg mb-5">Edit User</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Full Name</label>
                <input type="text" value={editForm.name} onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Role</label>
                  <select value={editForm.roleId} onChange={(e) => setEditForm(f => ({ ...f, roleId: e.target.value }))} className={inputCls}>
                    <option value="">Select role</option>
                    {Array.isArray(roles) && roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Department</label>
                  <select value={editForm.departmentId} onChange={(e) => setEditForm(f => ({ ...f, departmentId: e.target.value }))} className={inputCls}>
                    <option value="">None</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => editForm.name && editMutation.mutate({ id: editUser.id, data: { name: editForm.name, roleId: editForm.roleId || undefined, departmentId: editForm.departmentId || undefined } })}
                disabled={editMutation.isPending || !editForm.name}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {editMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
              <button onClick={() => setEditUser(null)} className="flex-1 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New User Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="font-bold text-slate-800 dark:text-white text-lg mb-5">Add New User</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Full Name *</label>
                <input type="text" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} className={inputCls} placeholder="Rajesh Kumar" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Email *</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="rajesh@technoedge.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Password *</label>
                <input type="password" value={form.password} onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} className={inputCls} placeholder="Min 6 characters" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Role *</label>
                  <select value={form.roleId} onChange={(e) => setForm(f => ({ ...f, roleId: e.target.value }))} className={inputCls}>
                    <option value="">Select role</option>
                    {Array.isArray(roles) && roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-gray-300 mb-1.5">Department</label>
                  <select value={form.departmentId} onChange={(e) => setForm(f => ({ ...f, departmentId: e.target.value }))} className={inputCls}>
                    <option value="">Select</option>
                    {Array.isArray(departments) && departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name && form.email && form.password && form.roleId && createMutation.mutate({ ...form, departmentId: form.departmentId || undefined })}
                disabled={createMutation.isPending || !form.name || !form.email || !form.password || !form.roleId}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
              >
                {createMutation.isPending ? 'Creating...' : 'Create User'}
              </button>
              <button onClick={() => setShowNew(false)} className="flex-1 border border-slate-200 dark:border-gray-700 text-slate-600 dark:text-gray-400 py-2.5 rounded-lg hover:bg-slate-50 dark:hover:bg-gray-800 text-sm">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
