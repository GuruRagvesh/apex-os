'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { rolesApi } from '@apex/core-organization-roles/api';
import { usersApi } from '@apex/core-users/api';
import { departmentsApi } from '@apex/core-organization-departments/api';
import { useAuthStore } from '@apex/core-identity';
import { cn, getInitials } from '@apex/shared-utilities';
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

/**
 * Archived is now a fact the server reports, from the audit trail.
 *
 * It used to be inferred from the email address -- `archived-<id>@apex.local`
 * -- which only worked because archival overwrote the person's name and email.
 * Archival no longer does that, so the old shape is kept only to recognise
 * accounts retired before the change.
 */
const isArchivedUser = (u: any): boolean =>
  Boolean(u.archivedAt) ||
  (!u.isActive &&
    typeof u.email === 'string' &&
    u.email.startsWith('archived-') &&
    u.email.endsWith('@apex.local'));

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
  const [form, setForm] = useState({ name: '', email: '', password: '', roleId: '', departmentId: '', joiningDate: '' });
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ name: '', roleId: '', departmentId: '', isActive: true, isHR: false });
  const [deactivateTarget, setDeactivateTarget] = useState<any | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<any | null>(null);
  const [permanentDeleteBlockers, setPermanentDeleteBlockers] = useState<Record<string, number> | null>(null);
  const [permanentDeleteBlockedUser, setPermanentDeleteBlockedUser] = useState<any | null>(null);
  const [backupDownloadedForUserId, setBackupDownloadedForUserId] = useState<string | null>(null);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

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
      setForm({ name: '', email: '', password: '', roleId: '', departmentId: '', joiningDate: '' });
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
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to deactivate user');
      setDeactivateTarget(null);
    },
  });

  const permanentDeleteMutation = useMutation({
    mutationFn: (vars: { id: string; user: any }) => usersApi.permanentDelete(vars.id),
    onSuccess: () => {
      toast.success('User permanently deleted');
      qc.invalidateQueries({ queryKey: ['users'] });
      setPermanentDeleteTarget(null);
    },
    onError: (err: any, vars) => {
      if (err?.blockers) {
        setPermanentDeleteBlockedUser(vars.user);
        setPermanentDeleteTarget(null);
        setPermanentDeleteBlockers(err.blockers);
      } else {
        toast.error(err?.message || 'Permanent delete failed');
        setPermanentDeleteTarget(null);
      }
    },
  });

  const archiveMutation = useMutation({
    mutationFn: (id: string) => usersApi.archiveAfterBackup(id, { confirmBackupDownloaded: true }),
    onSuccess: (res: any) => {
      toast.success(res?.message || 'User archived. Backup saved and emailed. Personal data anonymized.');
      qc.invalidateQueries({ queryKey: ['users'] });
      setPermanentDeleteBlockers(null);
      setPermanentDeleteBlockedUser(null);
      setBackupDownloadedForUserId(null);
      setArchiveConfirmOpen(false);
    },
    onError: (err: any) => toast.error(err?.message || 'Archive failed'),
  });

  // ADMIN + HR is the HR ADMIN and is allowed. Only SUPER_ADMIN is refused:
  // it administers the system rather than the workforce, so the flag would
  // grant it nothing while implying a role it does not hold. The server
  // refuses it independently.
  const editIsSuperAdminRole =
    (Array.isArray(roles) ? roles : []).find((r: any) => r.id === editForm.roleId)?.name ===
    'SUPER_ADMIN';

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
    const archived = isArchivedUser(u);
    const matchSearch = !search || u.name?.toLowerCase().includes(search.toLowerCase()) || u.email?.toLowerCase().includes(search.toLowerCase());
    const matchDept = !deptFilter || u.departmentId === deptFilter;
    const matchRole = !roleFilter || (u.role?.name ?? u.role) === roleFilter;
    let matchStatus: boolean;
    if (statusFilter === 'archived') { matchStatus = archived; }
    else if (statusFilter === 'all') { matchStatus = true; }
    else if (statusFilter === 'active') { matchStatus = u.isActive !== false && !archived; }
    else if (statusFilter === 'inactive') { matchStatus = u.isActive === false && !archived; }
    else { matchStatus = !archived; }
    return matchSearch && matchDept && matchRole && matchStatus;
  });
  const archivedCount = userList.filter(isArchivedUser).length;

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
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            {filteredUsers.length} of {userList.length} team members
            {archivedCount > 0 && statusFilter !== 'archived' && statusFilter !== 'all' && (
              <span className="ml-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
                ({archivedCount} archived)
              </span>
            )}
          </p>
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
          <option value="">Active &amp; Inactive</option>
          <option value="active">Active only</option>
          <option value="inactive">Inactive only</option>
          <option value="archived">Archived</option>
          <option value="all">All users</option>
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
                    {isArchivedUser(u) && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: '#fef3c7', color: '#b45309' }}>
                        ARCHIVED
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin && u.id !== me?.id && !isArchivedUser(u) && (
                  <div className="relative z-10 flex items-center gap-1 flex-shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEditUser(u);
                        setEditForm({ name: u.name, roleId: u.role?.id ?? '', departmentId: u.departmentId ?? '', isActive: u.isActive, isHR: !!u.isHR });
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
                      type="button"
                      onClick={async (e) => {
                        e.preventDefault();
                        e.stopPropagation();
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
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setPermanentDeleteTarget(u);
                        }}
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
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (u.isActive) {
                          setDeactivateTarget(u);
                        } else {
                          toggleActive.mutate({ id: u.id, isActive: true });
                        }
                      }}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
              {/*
                HR authority is a FLAG, not a role. There is no HR entry in the
                canonical ladder, and isHrOrAdmin() reads this field -- so this
                is the only thing that grants the HR permission set. Without a
                control here, appointing an HR user meant writing to the
                database by hand.

                Kept separate from Role because the two answer different
                questions: the role decides seniority, and therefore whose leave
                this person may approve; the flag decides HR reach.
              */}
              {/* ADMIN + HR is the HR ADMIN and is offered normally. Only
                  SUPER_ADMIN is blocked here, and the server refuses it too --
                  this is the explanation, not the enforcement. */}
              <label
                className="flex items-start gap-2.5 rounded-lg border p-3"
                style={{
                  borderColor: 'var(--border-secondary)',
                  cursor: editIsSuperAdminRole ? 'not-allowed' : 'pointer',
                  opacity: editIsSuperAdminRole ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={editForm.isHR && !editIsSuperAdminRole}
                  disabled={editIsSuperAdminRole}
                  onChange={(e) => setEditForm(f => ({ ...f, isHR: e.target.checked }))}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    HR authority
                  </span>
                  <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
                    {editIsSuperAdminRole
                      ? 'Not available for Super Admin — that role administers the system, not the workforce.'
                      : 'Company-wide access to attendance, exceptions, corrections, payroll and the month close. Combine with ADMIN for an HR administrator.'}
                  </span>
                </span>
              </label>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => editForm.name && editMutation.mutate({ id: editUser.id, data: { name: editForm.name, roleId: editForm.roleId || null, departmentId: editForm.departmentId || null, isHR: editIsSuperAdminRole ? false : editForm.isHR } })}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
                onClick={() => permanentDeleteMutation.mutate({ id: permanentDeleteTarget.id, user: permanentDeleteTarget })}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Cannot delete — user has linked records</h3>
            <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
              This user has operational history that prevents permanent deletion:
            </p>
            <ul className="mb-4 space-y-1.5">
              {Object.entries(permanentDeleteBlockers).map(([key, count]) => (
                <li key={key} className="flex justify-between text-sm px-1">
                  <span style={{ color: 'var(--text-secondary)' }}>{key}</span>
                  <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{count}</span>
                </li>
              ))}
            </ul>
            <div className="mb-4 rounded-lg p-3 space-y-1.5" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Required before archive:</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>✓ Backup will be emailed to responsible senior users</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>✓ Backup will be saved in backup vault</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>Optional: Download a local copy below</p>
            </div>
            <div className="space-y-2">
              <div className="flex gap-3">
                {permanentDeleteBlockedUser && (
                  <button
                    type="button"
                    onClick={async () => {
                      setDownloadingId(permanentDeleteBlockedUser.id);
                      const toastId = `backup-blocker-${permanentDeleteBlockedUser.id}`;
                      toast.loading('Downloading backup...', { id: toastId });
                      try {
                        await usersApi.downloadBackup(permanentDeleteBlockedUser.id, permanentDeleteBlockedUser.name);
                        toast.success('Backup downloaded', { id: toastId });
                        setBackupDownloadedForUserId(permanentDeleteBlockedUser.id);
                      } catch {
                        toast.error('Backup download failed', { id: toastId });
                      } finally {
                        setDownloadingId(null);
                      }
                    }}
                    disabled={downloadingId === permanentDeleteBlockedUser.id}
                    className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5 gap-1.5 disabled:opacity-50"
                  >
                    {downloadingId === permanentDeleteBlockedUser.id
                      ? <><Loader2 size={14} className="animate-spin" /> Downloading...</>
                      : <><Download size={14} /> {backupDownloadedForUserId === permanentDeleteBlockedUser.id ? 'Re-download Backup' : 'Download Backup'}</>
                    }
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setPermanentDeleteBlockers(null); setPermanentDeleteBlockedUser(null); setBackupDownloadedForUserId(null); }}
                  className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5"
                >
                  Close
                </button>
              </div>
              {permanentDeleteBlockedUser && (
                <button
                  type="button"
                  onClick={() => setArchiveConfirmOpen(true)}
                  disabled={archiveMutation.isPending}
                  className="apex-btn w-full justify-center py-2.5 font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: '#d97706' }}
                >
                  Archive after backup
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Archive After Backup Confirmation Modal */}
      {archiveConfirmOpen && permanentDeleteBlockedUser && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="apex-modal w-full max-w-md p-6 modal-enter">
            <h3 className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>Archive user?</h3>
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              Apex OS will email the backup to responsible senior users and save it in the backup vault <strong>before</strong> anonymizing <strong>{permanentDeleteBlockedUser.name}</strong>&apos;s personal data.
            </p>
            <p className="text-sm mb-2" style={{ color: 'var(--text-secondary)' }}>
              Tickets, work sessions, comments, leave records, and all reports will remain intact. The user&apos;s name, email, phone, address, and financial details will be removed.
            </p>
            <p className="text-xs mb-5" style={{ color: 'var(--text-tertiary)' }}>
              Archive will be blocked if vault or email delivery is not configured. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => archiveMutation.mutate(permanentDeleteBlockedUser.id)}
                disabled={archiveMutation.isPending}
                className="apex-btn flex-1 justify-center py-2.5 font-medium text-white disabled:opacity-50"
                style={{ backgroundColor: '#d97706' }}
              >
                {archiveMutation.isPending ? 'Archiving...' : 'Confirm Archive'}
              </button>
              <button
                type="button"
                onClick={() => setArchiveConfirmOpen(false)}
                className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New User Modal */}
      {showNew && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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
              <div>
                <label className="apex-label">Joining Date *</label>
                <input
                  type="date"
                  value={form.joiningDate}
                  onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))}
                  className="apex-input"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => form.name && form.email && form.password && form.roleId && form.joiningDate && createMutation.mutate({ ...form, departmentId: form.departmentId || null })}
                disabled={createMutation.isPending || !form.name || !form.email || !form.password || !form.roleId || !form.joiningDate}
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
