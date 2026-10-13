'use client';

// Archive User, Rehire User and Permanently Delete.
//
// Every decision here is re-made by the server: these modals show what the
// backend preflight reports and send only a random idempotency key (and, for
// deletion, the typed confirmation). The frontend never asserts that a backup
// exists, never sends counts and never chooses the actor.

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { usersApi } from '@apex/core-users/api';

/** A random UUID v4 for idempotency; never derived from the person. */
export function newIdempotencyKey(): string {
  const c: any = typeof globalThis !== 'undefined' ? (globalThis as any).crypto : undefined;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const BLOCKER_LABELS: Record<string, string> = {
  DIRECT_REPORTS: 'Direct reports',
  TEAM_MEMBERS_LED: 'Team members they lead',
  ACTIVE_TEAM_LEAD: 'Active teams they lead',
  MANAGED_DEPARTMENTS: 'Departments they manage',
  PENDING_LEAVE_APPROVALS: 'Leave requests waiting for their approval',
  PENDING_TICKET_APPROVALS: 'Ticket approvals waiting on them',
  PENDING_PROFILE_CHANGE_APPROVALS: 'Profile changes waiting for their approval',
  PENDING_ATTENDANCE_CORRECTION_APPROVALS: 'Attendance corrections waiting for their approval',
  OPEN_CRM_LEADS: 'Open CRM leads they own',
  ACTIVE_COLLEAGUE_ATTENDANCE_PROFILES: 'Colleagues whose attendance profile names them',
  TICKETS_AWAITING_APPROVAL: 'Their tickets still awaiting approval',
};

const WORK_LABELS: Record<string, string> = {
  soleTickets: 'Tickets or tasks only they are assigned to (will be closed)',
  sharedTickets: 'Shared tickets where they are the main assignee (next assignee takes over)',
  coAssignments: 'Shared tickets where they are a co-assignee (they will be removed)',
  watching: 'Open tickets they watch (they will be removed)',
  activeSessions: 'Active work sessions (ended at server time)',
  activeBreaks: 'Active breaks (ended at server time)',
  pendingOwnLeave: 'Their pending leave requests (cancelled)',
};

const RETENTION_LABELS: Record<string, string> = {
  ATTENDANCE: 'Attendance records',
  LEAVE: 'Leave records',
  PAYROLL: 'Closed payroll months',
};

function ModalShell({ title, children, onClose, labelledBy }: { title: string; children: React.ReactNode; onClose: () => void; labelledBy: string }) {
  return (
    <div
      className="fixed inset-0 !m-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="apex-modal w-full max-w-lg p-6 modal-enter max-h-[calc(100vh-2rem)] overflow-y-auto">
        <h3 id={labelledBy} className="font-bold text-lg mb-3" style={{ color: 'var(--text-primary)' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function CountList({ entries, labels }: { entries: [string, number][]; labels: Record<string, string> }) {
  return (
    <ul className="space-y-1.5 text-sm" style={{ color: 'var(--text-primary)' }}>
      {entries.map(([k, n]) => (
        <li key={k} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
          <span>{labels[k] ?? k}</span>
          <strong>{n}</strong>
        </li>
      ))}
    </ul>
  );
}

// ── Archive ─────────────────────────────────────────────────────────────────

export function ArchiveUserModal({ user, onClose, onArchived }: { user: any; onClose: () => void; onArchived: () => void }) {
  const key = useMemo(newIdempotencyKey, []);
  const preflight = useQuery({
    queryKey: ['user-lifecycle', 'archive-preflight', user.id],
    queryFn: () => usersApi.archivePreflight(user.id) as Promise<any>,
    staleTime: 0,
  });
  const archive = useMutation({
    mutationFn: () => usersApi.archive(user.id, key),
    onSuccess: () => {
      toast.success(`${user.name} archived.`);
      onArchived();
    },
    onError: (err: any) => toast.error(err?.message || 'Archive failed. Nothing was changed.'),
  });

  const p = preflight.data;
  const blockers = Object.entries(p?.blockers ?? {}) as [string, number][];
  const work = (Object.entries(p?.activeWork ?? {}) as [string, number][]).filter(([, n]) => n > 0);
  const hasWork = work.length > 0;

  return (
    <ModalShell title="Archive user?" onClose={onClose} labelledBy="archive-user-title">
      {preflight.isLoading && (
        <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={16} className="animate-spin" /> Checking active work and history…
        </p>
      )}
      {preflight.isError && <p className="text-sm text-red-600">{(preflight.error as any)?.message ?? 'Could not check this user.'}</p>}
      {p && (
        <div className="space-y-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong>{user.name}</strong> will be archived, not permanently deleted, and will move to Archived Users.</li>
            <li>Active work assigned to them will be closed or removed.</li>
            <li>{p.backupRequired ? 'A complete backup will be taken and verified before archiving.' : 'They have no history, so no backup file is needed; this is verified and recorded.'}</li>
            <li>Every change appears in the lifecycle audit trail.</li>
          </ul>
          {p.archiveCleanupPending && (
            <p className="rounded-lg p-3 text-amber-800 bg-amber-50">An earlier archive attempt is still being cleaned up. Try again shortly.</p>
          )}
          {blockers.length > 0 && (
            <div>
              <p className="mb-2 font-semibold" style={{ color: 'var(--text-primary)' }}>Hand these over before archiving:</p>
              <CountList entries={blockers} labels={BLOCKER_LABELS} />
            </div>
          )}
          {blockers.length === 0 && hasWork && (
            <div>
              <p className="mb-2" style={{ color: 'var(--text-primary)' }}>
                This user has active tickets or tasks. Before archiving, Apex OS will close or remove these assignments so they are not returned to the employee if rehired.
              </p>
              <CountList entries={work} labels={WORK_LABELS} />
              <p className="mt-2 text-xs">Sole assignments are closed. Shared work keeps going for the other assignees. Sessions end at server time. Every change is audited.</p>
            </div>
          )}
        </div>
      )}
      <div className="flex gap-3 mt-5">
        <button
          type="button"
          onClick={() => archive.mutate()}
          disabled={!p?.canArchive || archive.isPending}
          className="apex-btn flex-1 justify-center py-2.5 text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
          style={{ background: '#d97706' }}
        >
          {archive.isPending ? 'Archiving…' : hasWork ? 'Close active work and archive user' : 'Archive user'}
        </button>
        <button type="button" onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">
          {blockers.length > 0 ? 'Close' : 'Cancel'}
        </button>
      </div>
    </ModalShell>
  );
}

/** Today as YYYY-MM-DD in the browser's time zone. */
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Rehire ──────────────────────────────────────────────────────────────────

export function RehireUserModal({ user, roles, departments, onClose, onRehired }: { user: any; roles: any[]; departments: any[]; onClose: () => void; onRehired: () => void }) {
  const [form, setForm] = useState({
    name: user.name ?? '',
    email: user.email ?? '',
    password: '',
    roleId: user.role?.id ?? user.roleId ?? '',
    departmentId: user.departmentId ?? '',
    // Prefilled with their original joining date, which restores them as they
    // were; change it to the return date for a new period of employment.
    joiningDate: typeof user.joiningDate === 'string' && user.joiningDate ? user.joiningDate.slice(0, 10) : todayLocal(),
  });
  const rehire = useMutation({
    mutationFn: () => usersApi.rehire(user.id, { ...form, departmentId: form.departmentId || null }),
    onSuccess: (u: any) => {
      toast.success(`${u?.name ?? user.name} rehired. Their earlier history is kept.`);
      onRehired();
    },
    onError: (err: any) => toast.error(err?.message || 'Rehire failed'),
  });
  const ready = form.name.trim() && form.email.trim() && form.password.length >= 6 && form.roleId && form.joiningDate;
  return (
    <ModalShell title={`Rehire ${user.name}`} onClose={onClose} labelledBy="rehire-user-title">
      <p className="mb-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        This brings back the same account. Their earlier history stays with them; old active work is not reopened.
      </p>
      <div className="space-y-3">
        <div>
          <label className="apex-label" htmlFor="rehire-name">Full Name *</label>
          <input id="rehire-name" type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="apex-input" />
        </div>
        <div>
          <label className="apex-label" htmlFor="rehire-email">Email *</label>
          <input id="rehire-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="apex-input" />
        </div>
        <div>
          <label className="apex-label" htmlFor="rehire-password">New password *</label>
          <input id="rehire-password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="apex-input" placeholder="Min 6 characters" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="apex-label" htmlFor="rehire-role">Role *</label>
            <select id="rehire-role" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))} className="apex-select w-full">
              <option value="">Select role</option>
              {roles.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <label className="apex-label" htmlFor="rehire-department">Department</label>
            <select id="rehire-department" value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))} className="apex-select w-full">
              <option value="">Select</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="apex-label" htmlFor="rehire-joining">Rehire date *</label>
          <input id="rehire-joining" type="date" value={form.joiningDate} onChange={(e) => setForm((f) => ({ ...f, joiningDate: e.target.value }))} className="apex-input" />
          <p className="mt-1 text-xs" style={{ color: 'var(--text-secondary)' }}>Keep the original joining date to restore them as they were (their attendance continues). Use the return date for a new period of employment.</p>
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button type="button" onClick={() => rehire.mutate()} disabled={!ready || rehire.isPending} className="apex-btn apex-btn-primary flex-1 justify-center py-2.5 disabled:opacity-50">
          {rehire.isPending ? 'Rehiring…' : 'Rehire user'}
        </button>
        <button type="button" onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
      </div>
    </ModalShell>
  );
}

// ── Permanent delete ───────────────────────────────────────────────────────

export function PermanentDeleteModal({ user, onClose, onDeleted }: { user: any; onClose: () => void; onDeleted: () => void }) {
  const key = useMemo(newIdempotencyKey, []);
  const [confirmation, setConfirmation] = useState('');
  const preflight = useQuery({
    queryKey: ['user-lifecycle', 'delete-preflight', user.id],
    queryFn: () => usersApi.permanentDeletePreflight(user.id) as Promise<any>,
    staleTime: 0,
  });
  const del = useMutation({
    mutationFn: () => usersApi.permanentDelete(user.id, { idempotencyKey: key, confirmation }),
    onSuccess: (op: any) => {
      if (op?.state === 'CLEANUP_PENDING') toast.success('User deleted. Removing their original files is pending and will be retried.');
      else toast.success('User permanently deleted.');
      onDeleted();
    },
    onError: (err: any) => toast.error(err?.message || 'Permanent deletion failed. The user is still archived.'),
  });
  const p = preflight.data;
  const typedOk = confirmation.trim().toLowerCase() === String(user.email ?? '').trim().toLowerCase();
  const retentionCats = Object.entries(p?.retention?.categories ?? {}).filter(([, v]: any) => v.reason !== 'RELEASED').map(([k]) => RETENTION_LABELS[k] ?? k);

  return (
    <ModalShell title="Permanently delete user?" onClose={onClose} labelledBy="permanent-delete-title">
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        This archived user will be permanently removed from Apex OS. This cannot be undone. The existing archive backup will be verified; another backup will not be created.
      </p>
      {preflight.isLoading && (
        <p className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={16} className="animate-spin" /> Verifying the existing archive…
        </p>
      )}
      {preflight.isError && <p className="text-sm text-red-600">{(preflight.error as any)?.message ?? 'Could not verify this user.'}</p>}
      {p && !p.allowed && (
        <div className="mb-4 rounded-lg p-3 text-sm bg-red-50 text-red-800" role="alert">
          <ul className="list-disc space-y-1 pl-5">
            {p.reasons.map((r: any) => <li key={r.code}>{r.message}</li>)}
          </ul>
          {retentionCats.length > 0 && <p className="mt-2 text-xs">Held: {retentionCats.join(', ')}.</p>}
        </div>
      )}
      {p?.allowed && (
        <div>
          <label className="apex-label" htmlFor="permanent-delete-confirm">Type <strong>{user.email}</strong> to confirm</label>
          <input id="permanent-delete-confirm" type="text" autoComplete="off" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} className="apex-input" />
        </div>
      )}
      <div className="flex gap-3 mt-5">
        <button
          type="button"
          onClick={() => del.mutate()}
          disabled={!p?.allowed || !typedOk || del.isPending}
          className="apex-btn flex-1 justify-center py-2.5 text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
          style={{ background: '#dc2626' }}
        >
          {del.isPending ? 'Deleting…' : 'Permanently Delete'}
        </button>
        <button type="button" onClick={onClose} className="apex-btn apex-btn-secondary flex-1 justify-center py-2.5">Cancel</button>
      </div>
    </ModalShell>
  );
}
